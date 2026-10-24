import { createHash, randomUUID } from 'node:crypto';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Pool } from 'pg';
import type { ProcessingApiRuntime, UploadDeclaration } from '../api/processing-handler';
import { PostgresBenefitStore } from '../benefits/postgres-benefit-store';
import type { BenefitStore } from '../benefits/benefit-store';
import { prepareImageForProvider } from '../media/image';
import { ProcessingError, DefinitiveProviderError } from '../processing/contracts';
import type { OperationCapability, ProcessingArtifact, ProcessingFinancialStore, ProcessingJob, ProcessingProviderContext, ProcessingProviderPort, ProviderOutcome } from '../processing/contracts';
import { PostgresProcessingStore } from '../processing/postgres-processing-store';
import { ProcessingService } from '../processing/processing-service';
import { ProcessingWorker } from '../processing/processing-worker';
import { R2ProcessingJobStore, R2ProcessingQuoteStore, S3ConditionalJsonStore } from '../processing/r2-processing-store';
import { DewatermarkClient } from '../providers/dewatermark-client';
import { cloudRunDispatchDiagnostic } from './cloud-run-trigger';
import { MediaPreflight } from './media-preflight';
import type { UploadRecord } from './media-preflight';
import { mediaKey, PrivateMediaStore, SITE_MAX_IMAGE_BYTES, SITE_MAX_VIDEO_BYTES } from './private-media-store';
import { ProcessingProvider } from './processing-provider';
import { PublicProcessingProjection } from './public-projection';
import type { PublicArtifact } from './public-projection';

export type ExecutionTrigger = (action: 'process' | 'reconcile' | 'preflight', id: string, ownerId: string, existingExecutionRef?: string) => Promise<{ executionRef?: string; nextCheckAt: string }>;
export interface ProcessingRuntimeConfig {
  r2: { endpoint: string; accessKeyId: string; secretAccessKey: string; bucket: string };
  databaseUrl: string;
  apiKey?: string;
  ffprobePath?: string;
  providerMode: 'mock' | 'dewatermark';
  enabled?: boolean;
  priceVersion?: string;
  trigger?: ExecutionTrigger;
  /** Test ports are explicit; production defaults always use real SDK adapters. */
  dependencies?: {
    client?: S3Client;
    pool?: Pool;
    finance?: ProcessingFinancialStore;
    benefits?: Pick<BenefitStore, 'getSummary'>;
    provider?: ProcessingProviderPort;
    signUrl?: typeof getSignedUrl;
    now?: () => Date;
    id?: () => string;
  };
}
export interface PublicUpload {
  id: string;
  uploadId: string;
  kind: 'image' | 'video' | 'mask';
  status: UploadRecord['status'];
  createdAt: string;
  expiresAt: string;
  artifactId?: string;
  artifact?: PublicArtifact;
  previewUrl?: string;
  error?: string;
}
export interface ProcessingRuntime extends ProcessingApiRuntime {
  ensureAccountIdentity(ownerId: string, email: string): Promise<void>;
  beginUpload(ownerId: string, declaration: UploadDeclaration): Promise<PublicUpload & { uploadUrl: string; method: 'PUT'; headers: { 'Content-Type': string } }>;
  completeUpload(ownerId: string, id: string): Promise<PublicUpload>;
  getUpload(ownerId: string, id: string): Promise<PublicUpload>;
  projectJob: PublicProcessingProjection['job'];
  projectQuote: PublicProcessingProjection['quote'];
  download(ownerId: string, id: string): ReturnType<PublicProcessingProjection['download']>;
  runJob(jobId: string, workerId?: string): Promise<ProcessingJob>;
  runPreflight(ownerId: string, id: string): Promise<PublicUpload>;
  close(): Promise<void>;
}

/** Local simulation writes real private result bytes; it never claims AI removal. */
class MockPrivateProcessingProvider implements ProcessingProviderPort {
  constructor(private readonly media: PrivateMediaStore, private readonly now: () => Date, private readonly id: () => string) {}
  private receipt(context: ProcessingProviderContext) { return `processing/mock-attempts/${context.job.id}/${context.job.attempt!.id}.json`; }
  async submit(context: ProcessingProviderContext): Promise<ProviderOutcome> {
    const existing = await this.media.getJson<ProcessingArtifact>(this.receipt(context));
    if (existing) return this.recover(existing);
    await context.heartbeat();
    await this.media.verifyStored(context.input);
    if (context.mask) await this.media.verifyStored(context.mask);
    let bytes = await this.media.getBytes(context.input.key, context.input.metadata.kind === 'video' ? SITE_MAX_VIDEO_BYTES : 48 * 1024 * 1024);
    if (context.input.metadata.kind === 'image') bytes = (await prepareImageForProvider(bytes, { maxBytes: 48 * 1024 * 1024 })).bytes;
    const metadata = await this.media.inspectBytes(bytes, context.input.metadata.kind);
    const id = this.id(); const created = this.now();
    const artifact: ProcessingArtifact = { id, ownerId: context.job.ownerId, key: mediaKey('result', context.job.ownerId, id, metadata.contentType),
      role: 'result', sealed: true, sha256: createHash('sha256').update(bytes).digest('hex'), metadata, parentArtifactId: context.input.id,
      ...(metadata.kind === 'image' && context.job.operation !== 'image-watermark-pro' ? { providerSessionId: `mock-${id}` } : {}),
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
  const deps = config.dependencies ?? {};
  const now = deps.now ?? (() => new Date()); const id = deps.id ?? randomUUID;
  // Presigning a browser PUT has no body yet. SDK default CRC32 would bind its
  // empty body, rejecting the actual upload. R2 sealing still verifies SHA-256.
  // https://docs.aws.amazon.com/sdkref/latest/guide/feature-dataintegrity.html
  const client = deps.client ?? new S3Client({ endpoint: config.r2.endpoint, region: 'auto', forcePathStyle: true, requestChecksumCalculation: 'WHEN_REQUIRED', credentials: { accessKeyId: config.r2.accessKeyId, secretAccessKey: config.r2.secretAccessKey } });
  const pool = deps.pool ?? new Pool({ connectionString: config.databaseUrl });
  const finance = deps.finance ?? new PostgresProcessingStore(pool);
  const benefits = deps.benefits ?? new PostgresBenefitStore(pool);
  const media = new PrivateMediaStore({ client, bucket: config.r2.bucket, ffprobePath: config.ffprobePath, signUrl: deps.signUrl, now });
  const json = new S3ConditionalJsonStore(client, config.r2.bucket);
  const jobs = new R2ProcessingJobStore(json); const quotes = new R2ProcessingQuoteStore(json);
  const preflight = new MediaPreflight({ media, ffprobePath: config.ffprobePath, now, id });
  const available = config.enabled !== false && (config.providerMode === 'mock' || Boolean(config.apiKey?.trim()));
  const reason = 'Processing is not configured. Your existing files and account allowance are retained.';
  const capabilities: OperationCapability[] = [
    { operation: 'image-watermark', enabled: available, acceptedTypes: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: SITE_MAX_IMAGE_BYTES },
    { operation: 'image-watermark-pro', enabled: available, acceptedTypes: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: SITE_MAX_IMAGE_BYTES },
    { operation: 'image-refine', enabled: available, acceptedTypes: ['image/jpeg'], maxBytes: 48 * 1024 * 1024 },
    { operation: 'video-watermark', enabled: available, acceptedTypes: ['video/mp4'], maxBytes: SITE_MAX_VIDEO_BYTES, maxDurationSeconds: 540, requiredFps: 24 },
  ].map((capability) => ({ ...capability, ...(!available ? { reason } : {}) })) as OperationCapability[];
  const core = new ProcessingService({ jobs, artifacts: media, quotes, finance, capabilities,
    inspector: { inspect: async (owner, artifactId) => { const a = await media.get(artifactId); if (!a || a.ownerId !== owner) throw new ProcessingError('artifact_not_found', 'Validated input was not found', 404); return a; } },
    prices: { version: config.priceVersion ?? 'processing-v1', amount: (operation, input) => operation === 'image-watermark-pro' ? 3 : operation === 'video-watermark' ? Math.ceil(input.durationSeconds! * 0.5) : 1 }, now, id });
  const service: ProcessingApiRuntime['service'] = {
    capabilities: () => core.capabilities(),
    quote: async (request) => { await benefits.getSummary(request.ownerId); return core.quote(request); },
    submit: (request) => core.submit(request), get: (owner, jobId) => core.get(owner, jobId), list: (owner, limit) => core.list(owner, limit),
  };
  const unavailableProvider: ProcessingProviderPort = {
    submit: async () => { throw new DefinitiveProviderError('Provider configuration is unavailable before processing'); },
    poll: async () => { throw new Error('Provider configuration is required to reconcile the existing operation'); },
  };
  const provider = deps.provider ?? (config.providerMode === 'mock' ? new MockPrivateProcessingProvider(media, now, id) : config.apiKey?.trim() ? new ProcessingProvider({ client: new DewatermarkClient({ apiKey: config.apiKey }), media, ffprobePath: config.ffprobePath, now, id }) : unavailableProvider);
  const worker = new ProcessingWorker({ jobs, artifacts: media, finance, provider, now, id });
  const projection = new PublicProcessingProjection({ media, now, isDemo: config.providerMode === 'mock', refinementEnabled: available,
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
    async ensureAccountIdentity(owner, email) { await benefits.getSummary(owner, email); },
    async beginUpload(owner, declaration) {
      const allowed = declaration.kind === 'video' ? capabilities.find((c) => c.operation === 'video-watermark')?.enabled : declaration.kind === 'mask' ? capabilities.some((c) => c.enabled && ['image-refine', 'video-watermark'].includes(c.operation)) : capabilities.some((c) => c.enabled && c.operation.startsWith('image-'));
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
    async balances(owner) { const legacy = await benefits.getSummary(owner); return { freeUses: legacy.balance, processingCredits: await finance.getBalance(owner) }; },
    async download(owner, jobId) { return projection.download(owner, await core.get(owner, jobId)); },
    async runJob(jobId, workerId = `worker-${id()}`) { return worker.run(jobId, workerId); },
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
          if (message.action === 'preflight') {
            const upload = await preflight.getUploadForWorker(owner, message.jobId);
            // Permanent failures are acknowledged by runPreflight. A failed
            // record alone may have come from a retryable storage outage.
            if (upload.status === 'ready' || upload.status === 'expired') { await finance.completeOutbox(message.jobId); continue; }
          } else {
            const job = await core.get(owner, message.jobId);
            if (['READY', 'FAILED', 'REFUNDED', 'EXPIRED'].includes(job.status)) { await finance.completeOutbox(message.jobId); continue; }
          }
          const result = await config.trigger(message.action, message.jobId, owner, message.executionRef);
          if (!Number.isFinite(Date.parse(result.nextCheckAt))) throw new Error('Execution monitor deadline is invalid');
          await finance.recordDispatch(message.id, dispatcherId, result.nextCheckAt, result.executionRef);
        } catch (error) {
          const delay = Math.min(15 * 60_000, 60_000 * 2 ** Math.min(4, Math.max(0, message.attempts - 1)));
          await finance.retryDispatch(message.id, dispatcherId, new Date(now().getTime() + delay).toISOString(), cloudRunDispatchDiagnostic(error));
        }
      }
    },
    async close() { if (!deps.pool) await pool.end(); if (!deps.client) client.destroy(); },
  };
  return runtime;
}
