import { createHash, randomUUID } from 'node:crypto';
import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Pool } from 'pg';
import type { ProcessingApiRuntime, UploadDeclaration } from '../api/processing-handler';
import { PostgresBenefitStore } from '../benefits/postgres-benefit-store';
import type { BenefitStore } from '../benefits/benefit-store';
import { prepareImageForProvider } from '../media/image';
import { ProcessingError, DefinitiveProviderError } from '../processing/contracts';
import type { OperationCapability, ProcessingArtifact, ProcessingFinancialStore, ProcessingJob } from '../processing/contracts';
import { ProcessingDispatchRecovery } from '../processing/dispatch-recovery';
import { PostgresProcessingStore } from '../processing/postgres-processing-store';
import { ProcessingService } from '../processing/processing-service';
import { ProcessingWorker } from '../processing/processing-worker';
import { R2ProcessingJobStore, R2ProcessingQuoteStore, S3ConditionalJsonStore } from '../processing/r2-processing-store';
import { DewatermarkClient } from '../providers/dewatermark-client';
import type { ProcessingProviderContext, WatermarkProvider, ProviderOutcome } from '../providers/watermark-provider';
import { CloudRunTriggerError, cloudRunDispatchDiagnostic } from './cloud-run-trigger';
import { MediaPreflight } from './media-preflight';
import type { UploadRecord } from './media-preflight';
import { mediaKey, PrivateMediaStore, SITE_MAX_VIDEO_BYTES } from './private-media-store';
import { ProcessingProvider } from './processing-provider';
import { PublicProcessingProjection } from './public-projection';
import type { PublicUpload, PublicUploadTicket } from '../contracts/processing-public';
import type { ImageCreditCosts } from '../payments/image-credit-prices';
import { durableCapabilities } from '../contracts/operation-catalog';
import { getWebDatabasePool } from './web-database-pool';
import sharp from 'sharp';
import type { ImageProviderConfig } from '../config/image-providers';
import { ReplicateImageProvider } from './replicate-image-provider';
import { SensitiveRetention } from '../processing/sensitive-retention';
import type { CreditsConfiguration } from '../credits/credit-policy';
export type { PublicUpload } from '../contracts/processing-public';

export type ExecutionTrigger = (action: 'process' | 'reconcile' | 'preflight', id: string, ownerId: string, existingExecutionRef?: string, dispatchId?: string) => Promise<{ executionRef?: string; nextCheckAt: string; terminal?: boolean }>;
export interface ProcessingRuntimeConfig {
  credits?: CreditsConfiguration;
  r2: { endpoint: string; accessKeyId: string; secretAccessKey: string; bucket: string };
  databaseUrl: string;
  apiKey?: string;
  ffprobePath?: string;
  providerMode: 'mock' | 'dewatermark';
  scope?: 'web' | 'worker';
  imageProviders?: ImageProviderConfig;
  enabled?: boolean;
  priceVersion?: string;
  imageCredits?: { enabled: boolean; environment: 'sandbox' | 'live'; costs?: ImageCreditCosts; priceVersion?: string };
  trigger?: ExecutionTrigger;
  /** Test ports are explicit; production defaults always use real SDK adapters. */
  dependencies?: {
    client?: S3Client;
    pool?: Pool;
    finance?: ProcessingFinancialStore;
    benefits?: Pick<BenefitStore, 'getSummary'>;
    provider?: WatermarkProvider;
    signUrl?: typeof getSignedUrl;
    now?: () => Date;
    id?: () => string;
  };
}
export interface ProcessingRuntime extends ProcessingApiRuntime {
  beginUpload(ownerId: string, declaration: UploadDeclaration): Promise<PublicUploadTicket>;
  completeUpload(ownerId: string, id: string): Promise<PublicUpload>;
  getUpload(ownerId: string, id: string): Promise<PublicUpload>;
  projectJob: PublicProcessingProjection['job'];
  projectQuote: PublicProcessingProjection['quote'];
  download(ownerId: string, id: string): ReturnType<PublicProcessingProjection['download']>;
  runJob(jobId: string, workerId?: string, dispatchId?: string): Promise<ProcessingJob>;
  runPreflight(ownerId: string, id: string): Promise<PublicUpload>;
  retainExpired?: SensitiveRetention['run'];
  close(): Promise<void>;
}

/** Local simulation writes real private result bytes; it never claims AI removal. */
class MockPrivateProcessingProvider implements WatermarkProvider {
  constructor(private readonly media: PrivateMediaStore, private readonly now: () => Date, private readonly id: () => string) {}
  private receipt(context: ProcessingProviderContext) { return `processing/mock-attempts/${context.job.id}/${context.job.attempt!.id}.json`; }
  async submit(context: ProcessingProviderContext): Promise<ProviderOutcome> {
    const existing = await this.media.getJson<ProcessingArtifact>(this.receipt(context));
    if (existing) return this.recover(existing);
    if (['background-removal', 'object-removal'].includes(context.job.operation)) await context.checkpoint({ provider: 'mock' });
    await context.heartbeat();
    await this.media.verifyStored(context.input);
    if (context.mask) await this.media.verifyStored(context.mask);
    let bytes = await this.media.getBytes(context.input.key, context.input.metadata.kind === 'video' ? SITE_MAX_VIDEO_BYTES : 48 * 1024 * 1024);
    if (context.input.metadata.kind === 'image') bytes = ['background-removal', 'object-removal'].includes(context.job.operation)
      ? await sharp(bytes).rotate().ensureAlpha().png().toBuffer()
      : (await prepareImageForProvider(bytes, { maxBytes: 48 * 1024 * 1024 })).bytes;
    const metadata = await this.media.inspectBytes(bytes, context.input.metadata.kind);
    const id = this.id(); const created = this.now();
    const artifact: ProcessingArtifact = { id, ownerId: context.job.ownerId, key: mediaKey('result', context.job.ownerId, id, metadata.contentType),
      role: 'result', sealed: true, sha256: createHash('sha256').update(bytes).digest('hex'), metadata, parentArtifactId: context.input.id,
      ...(metadata.kind === 'image' && ['image-watermark', 'image-refine'].includes(context.job.operation) ? { providerSessionId: `mock-${id}` } : {}),
      createdAt: created.toISOString(), expiresAt: new Date(created.getTime() + 24 * 60 * 60_000).toISOString() };
    await this.media.putBytes(artifact.key, bytes, metadata.contentType, { 'owner-id': artifact.ownerId, 'artifact-id': artifact.id }, true);
    await this.media.putJson(this.receipt(context), artifact, true);
    return this.recover(artifact);
  }
  async poll(context: ProcessingProviderContext): Promise<ProviderOutcome> {
    const artifact = await this.media.getJson<ProcessingArtifact>(this.receipt(context));
    if (!artifact) throw new Error('Mock receipt is awaiting reconciliation');
    return this.recover(artifact);
  }
  private async recover(artifact: ProcessingArtifact): Promise<ProviderOutcome> { await this.media.create(artifact); await this.media.verifyStored(artifact); return { status: 'completed', artifact }; }
}

/** No Astro imports, process globals, background promises or startup network calls. */
export function createProcessingRuntime(config: ProcessingRuntimeConfig): ProcessingRuntime {
  if (config.imageCredits?.enabled && config.imageCredits.environment === 'live' && (!config.imageCredits.costs || !config.imageCredits.priceVersion)) throw new Error('Live image-credit operation prices are required');
  const deps = config.dependencies ?? {};
  const now = deps.now ?? (() => new Date()); const id = deps.id ?? randomUUID;
  const pool = deps.pool ?? (config.scope === 'web' ? getWebDatabasePool(config.databaseUrl) : new Pool({ connectionString: config.databaseUrl }));
  const ownsPool = !deps.pool && config.scope !== 'web';
  // Presigning a browser PUT has no body yet. SDK default CRC32 would bind its
  // empty body, rejecting the actual upload. R2 sealing still verifies SHA-256.
  // https://docs.aws.amazon.com/sdkref/latest/guide/feature-dataintegrity.html
  const client = deps.client ?? new S3Client({ endpoint: config.r2.endpoint, region: 'auto', forcePathStyle: true, requestChecksumCalculation: 'WHEN_REQUIRED', credentials: { accessKeyId: config.r2.accessKeyId, secretAccessKey: config.r2.secretAccessKey } });
  if (config.credits && config.imageCredits && config.credits.environment !== config.imageCredits.environment) throw new Error('Wallet and payment environments differ');
  const finance = deps.finance ?? new PostgresProcessingStore(pool, { imageCreditsEnabled: config.imageCredits?.enabled, paymentEnvironment: config.imageCredits?.environment ?? config.credits?.environment ?? 'sandbox', credits: config.credits });
  const benefits = deps.benefits ?? new PostgresBenefitStore(pool, config.imageCredits?.enabled ?? false, config.imageCredits?.environment ?? config.credits?.environment ?? 'sandbox', config.imageCredits?.costs, config.imageCredits?.priceVersion, config.credits);
  const media = new PrivateMediaStore({ client, bucket: config.r2.bucket, ffprobePath: config.ffprobePath, signUrl: deps.signUrl, now });
  const json = new S3ConditionalJsonStore(client, config.r2.bucket);
  const jobs = new R2ProcessingJobStore(json); const quotes = new R2ProcessingQuoteStore(json);
  const recovery = new ProcessingDispatchRecovery({ jobs, finance, now, id });
  const preflight = new MediaPreflight({ media, ffprobePath: config.ffprobePath, now, id });
  const available = config.enabled !== false && (config.providerMode === 'mock' || Boolean(config.apiKey?.trim()));
  const backgroundMode = config.imageProviders?.BACKGROUND_REMOVAL_PROVIDER ?? 'mock';
  const objectMode = config.imageProviders?.OBJECT_REMOVAL_PROVIDER ?? 'mock';
  const reason = 'Processing is not configured. Your existing files and account allowance are retained.';
  const capabilities: OperationCapability[] = durableCapabilities(available, reason).map(capability => {
    if (!['background-removal', 'object-removal'].includes(capability.operation)) return capability;
    const mode = capability.operation === 'object-removal' ? objectMode : backgroundMode;
    const enabled = config.enabled !== false && (mode === 'mock' || Boolean(config.imageProviders?.REPLICATE_API_TOKEN?.trim()));
    return { ...capability, enabled, reason: enabled ? undefined : reason };
  });
  const core = new ProcessingService({ jobs, artifacts: media, quotes, finance, capabilities, credits: config.credits, purchasedImageCreditsEnabled: config.imageCredits?.enabled, purchasedImageCreditCost: config.imageCredits?.costs?.['watermark-removal'], imageCreditCosts: config.imageCredits?.costs, imageCreditPriceVersion: config.imageCredits?.priceVersion,
    inspector: { inspect: async (owner, artifactId) => { const a = await media.get(artifactId); if (!a || a.ownerId !== owner) throw new ProcessingError('artifact_not_found', 'Validated input was not found', 404); return a; } },
    prices: { version: config.priceVersion ?? 'processing-v1', amount: (operation, input) => operation === 'image-watermark-pro' ? 3 : operation === 'video-watermark' ? Math.ceil(input.durationSeconds! * 0.5) : 1 }, now, id });
  const service: ProcessingApiRuntime['service'] = {
    capabilities: () => core.capabilities(),
    quote: (request) => core.quote(request),
    submit: (request) => core.submit(request), get: (owner, jobId) => core.get(owner, jobId), list: (owner, limit) => core.list(owner, limit),
  };
  const unavailableProvider: WatermarkProvider = {
    submit: async () => { throw new DefinitiveProviderError('Provider configuration is unavailable before processing'); },
    poll: async () => { throw new Error('Provider configuration is required to reconcile the existing operation'); },
  };
  let worker: ProcessingWorker | undefined;
  function executionWorker() {
    if (worker) return worker;
    let mock: WatermarkProvider | undefined; let watermark: WatermarkProvider | undefined;
    const imageAdapters: Partial<Record<'background-removal' | 'object-removal', WatermarkProvider>> = {};
    const mockProvider = () => (mock ??= new MockPrivateProcessingProvider(media, now, id));
    function selected(context: ProcessingProviderContext) {
      if (deps.provider) return deps.provider;
      const operation = context.job.operation;
      if (operation !== 'background-removal' && operation !== 'object-removal') return (watermark ??= config.providerMode === 'mock' ? mockProvider() : config.apiKey?.trim() ? new ProcessingProvider({ client: new DewatermarkClient({ apiKey: config.apiKey }), media, ffprobePath: config.ffprobePath, now, id }) : unavailableProvider);
      const mode = context.job.attempt?.checkpoint?.provider ?? (operation === 'object-removal' ? objectMode : backgroundMode);
      if (mode === 'mock') return mockProvider();
      const image = config.imageProviders;
      return (imageAdapters[operation] ??= image?.REPLICATE_API_TOKEN ? new ReplicateImageProvider({ media, operation, config: { apiToken: image.REPLICATE_API_TOKEN, baseUrl: image.REPLICATE_BASE_URL, modelVersion: operation === 'object-removal' ? image.REPLICATE_LAMA_MODEL_VERSION : image.REPLICATE_BACKGROUND_MODEL_VERSION, timeoutMs: image.REPLICATE_TIMEOUT_MS, waitSeconds: image.REPLICATE_WAIT_SECONDS }, now, id }) : unavailableProvider);
    }
    const provider: WatermarkProvider = { submit: context => selected(context).submit(context), poll: context => selected(context).poll(context) };
    return (worker = new ProcessingWorker({ jobs, artifacts: media, finance, provider, now, id }));
  }
  let closing: Promise<void> | undefined;
  const projection = new PublicProcessingProjection({ media, now, isDemoFor: operation => operation === 'object-removal' ? objectMode === 'mock' : operation === 'background-removal' ? backgroundMode === 'mock' : config.providerMode === 'mock', refinementEnabled: available,
    signPreview: (artifact, seconds) => (deps.signUrl ?? getSignedUrl)(client, new GetObjectCommand({ Bucket: config.r2.bucket, Key: artifact.key, ResponseContentDisposition: 'inline', ResponseCacheControl: 'private, no-store' }), { expiresIn: seconds }) });
  const projectUpload = async (owner: string, record: UploadRecord): Promise<PublicUpload> => {
    const artifact = record.artifactId ? await media.get(record.artifactId) : null;
    const view = artifact ? await projection.artifact(owner, artifact) : undefined;
    return { id: record.id, uploadId: record.id, kind: record.kind, status: record.status, createdAt: record.createdAt, expiresAt: view?.expiresAt ?? record.expiresAt,
      ...(view ? { artifactId: view.id, artifact: view, ...(view.previewUrl ? { previewUrl: view.previewUrl } : {}) } : {}),
      ...(record.status === 'failed' ? { error: 'File validation failed. Select a compatible file and try again.' } : {}),
      ...(record.status === 'expired' ? { error: 'Upload has expired. Select the file again.' } : {}) };
  };
  const runtime: ProcessingRuntime = {
    service,
    async beginUpload(owner, declaration) {
      const allowed = declaration.kind === 'video' ? capabilities.find((c) => c.operation === 'video-watermark')?.enabled : declaration.kind === 'mask' ? capabilities.some((c) => c.enabled && ['image-refine', 'video-watermark', 'object-removal'].includes(c.operation)) : capabilities.some((c) => c.enabled && c.acceptedTypes.some(type => type.startsWith('image/')));
      if (!allowed) throw new ProcessingError('operation_unavailable', reason, 503);
      const upload = await preflight.createUpload(owner, declaration);
      return { ...await projectUpload(owner, upload.upload), uploadUrl: upload.uploadUrl, method: 'PUT', headers: { 'Content-Type': declaration.contentType } };
    },
    async completeUpload(owner, uploadId) {
      const record = await preflight.getUpload(owner, uploadId);
      if (record.status === 'ready' || record.status === 'failed') return projectUpload(owner, record);
      await finance.enqueuePreflight(owner, uploadId, now().toISOString());
      const key = `processing/uploads/${record.id}.json`;
      const current = await media.getVersionedJson<UploadRecord>(key);
      if (current?.value.ownerId === owner && current.value.status === 'created') await media.compareAndSwapJson(key, current.version, { ...current.value, status: 'validating' });
      return runtime.getUpload(owner, uploadId);
    },
    async getUpload(owner, uploadId) { return projectUpload(owner, await preflight.getUpload(owner, uploadId)); },
    projectJob: (owner, job) => projection.job(owner, job), projectQuote: (owner, quote) => projection.quote(owner, quote),
    async balances(owner, email) {
      const allowance = await benefits.getSummary(owner, email);
      if (allowance.walletMode === 'unified') return { walletMode: 'unified', unit: 'credits', credits: allowance.credits, admissionEnabled: config.credits?.admissionEnabled ?? false };
      return { freeUses: allowance.balance, processingCredits: await finance.getBalance(owner), ...(config.imageCredits?.enabled ? { purchasedImageCredits: allowance.paidBalance ?? await finance.getBalance(owner, 'purchasedImageCredits') } : {}) };
    },
    async download(owner, jobId) { return projection.download(owner, await core.get(owner, jobId)); },
    async runJob(jobId, workerId = `worker-${id()}`, dispatchId) { return executionWorker().run(jobId, workerId, dispatchId); },
    async retainExpired(options) {
      let readBytes = 0;
      const retention = new SensitiveRetention({ finance, now, objects: {
        async list(prefix) {
          const keys: string[] = []; let token: string | undefined;
          do {
            const page = await client.send(new ListObjectsV2Command({ Bucket: config.r2.bucket, Prefix: prefix, MaxKeys: 250, ContinuationToken: token }));
            for (const object of page.Contents ?? []) {
              if (!object.Key?.startsWith(prefix) || !object.Key.endsWith('.json')) throw new Error('Retention inventory contains an invalid control key');
              keys.push(object.Key);
            }
            if (keys.length > 2000 || page.IsTruncated && (!page.NextContinuationToken || page.NextContinuationToken === token)) throw new Error('Retention inventory exceeds a safe complete scan');
            token = page.IsTruncated ? page.NextContinuationToken : undefined;
          } while (token);
          return keys.sort();
        },
        async get<T>(key: string) {
          const record = await media.getVersionedJson<T>(key, 48 * 1024 * 1024 + 65_536);
          if (record) readBytes += Buffer.byteLength(JSON.stringify(record.value));
          if (readBytes > 128 * 1024 * 1024) throw new Error('Retention inventory exceeds the safe byte limit');
          return record;
        },
        update: (key, version, value) => media.compareAndSwapJson(key, version, value),
      } });
      return retention.run(options);
    },
    async runPreflight(owner, uploadId) {
      const record = await preflight.getUploadForWorker(owner, uploadId);
      if (record.status === 'expired') { await finance.completeOutbox(uploadId); return projectUpload(owner, record); }
      try { await preflight.inspect(owner, uploadId); await finance.completeOutbox(uploadId); return runtime.getUpload(owner, uploadId); }
      catch (error) {
        const failed = await preflight.getUploadForWorker(owner, uploadId).catch(() => null);
        if (failed?.status === 'expired') { await finance.completeOutbox(uploadId); return projectUpload(owner, failed); }
        if (failed?.status === 'failed' && (!(error instanceof ProcessingError) || error.status < 500)) { await finance.completeOutbox(uploadId); return projectUpload(owner, failed); }
        if (failed?.status === 'failed' && error instanceof ProcessingError && error.status >= 500) {
          try {
            const key = `processing/uploads/${failed.id}.json`;
            const current = await media.getVersionedJson<UploadRecord>(key);
            if (current?.value.ownerId === owner && current.value.status === 'failed') await media.compareAndSwapJson(key, current.version, { ...current.value, status: 'validating', error: undefined });
          } catch { /* Durable delivery still retries even if storage cannot accept this UI repair. */ }
        }
        throw error;
      }
    },
    async dispatch() {
      if (!config.trigger) return;
      const dispatcherId = `dispatcher-${id()}`;
      const messages = await finance.claimDue(now().toISOString(), dispatcherId, 10);
      for (const message of messages) {
        try {
          const owner = message.ownerId ?? (await jobs.get(message.jobId))?.job.ownerId;
          if (!owner) throw new Error('Outbox ownership is unavailable');
          let result: Awaited<ReturnType<ExecutionTrigger>>;
          if (message.action === 'preflight') {
            const upload = await preflight.getUploadForWorker(owner, message.jobId);
            // Permanent failures are acknowledged by runPreflight. A failed
            // record alone may have come from a retryable storage outage.
            if (upload.status === 'ready' || upload.status === 'expired') { await finance.completeOutbox(message.jobId); continue; }
            result = await config.trigger(message.action, message.jobId, owner, message.executionRef);
          } else {
            await core.get(owner, message.jobId);
            // Resume fenced refunds before considering any terminal status.
            const job = await recovery.recover(message.jobId);
            if (job.refundIntent && job.chargeStatus !== 'refunded') throw new Error('Refund intent is awaiting recovery');
            if (['READY', 'FAILED', 'REFUNDED', 'EXPIRED'].includes(job.status)) { await finance.completeOutbox(message.jobId); continue; }
            // Persist uncertainty before POST; a lost acknowledgement must only
            // monitor this dispatch rather than silently starting another one.
            const prepared = await recovery.prepare(message.jobId, message.executionRef);
            try {
              result = await config.trigger(message.action, message.jobId, owner, prepared.start ? undefined : prepared.executionRef, prepared.dispatchId);
            } catch (error) {
              // A known refusal may retry with a fresh durable nonce. Lookup,
              // monitoring and acknowledgement failures keep their current one.
              if (prepared.start && error instanceof CloudRunTriggerError && error.acceptance === 'not-accepted') await recovery.accepted(message.jobId, prepared.dispatchId, undefined, true);
              throw error;
            }
            await recovery.accepted(message.jobId, prepared.dispatchId, result.executionRef, result.terminal);
          }
          if (!Number.isFinite(Date.parse(result.nextCheckAt))) throw new Error('Execution monitor deadline is invalid');
          await finance.recordDispatch(message.id, dispatcherId, result.nextCheckAt, result.executionRef);
        } catch (error) {
          const delay = Math.min(15 * 60_000, 60_000 * 2 ** Math.min(4, Math.max(0, message.attempts - 1)));
          await finance.retryDispatch(message.id, dispatcherId, new Date(now().getTime() + delay).toISOString(), cloudRunDispatchDiagnostic(error));
        }
      }
    },
    close() {
      return (closing ??= (async () => {
        try { if (ownsPool) await pool.end(); }
        finally { if (!deps.client) client.destroy(); }
      })());
    },
  };
  return runtime;
}
