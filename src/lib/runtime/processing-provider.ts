import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { inspectMask, prepareImageForProvider } from '../media/image';
import { DefinitiveProviderError, ProcessingError, type ProcessingArtifact } from '../processing/contracts';
import type { ProcessingProviderContext, ProcessingWatermarkProvider, ProviderOutcome } from '../providers/watermark-provider';
import { DewatermarkClient, DewatermarkRequestError, type ImageRequest } from '../providers/dewatermark-client';
import { mediaKey, PrivateMediaStore, safeMediaId, SITE_MAX_IMAGE_BYTES, SITE_MAX_VIDEO_BYTES } from './private-media-store';

interface PrivateProviderMetadata {
  mode: ImageRequest['mode'];
  sessionId?: string;
  imageId?: string;
  eventId?: string;
}
interface ResultReceipt { artifact: ProcessingArtifact; providerMetadata?: PrivateProviderMetadata }
// Match the SDK's bounded JSON envelope, plus room for our artifact record.
// Older private receipts may contain masks larger than the generic read limit.
// New writes explicitly retain session/recovery identifiers only.
const PROVIDER_METADATA_MAX_BYTES = 48 * 1024 * 1024;
const PROVIDER_RECEIPT_MAX_BYTES = PROVIDER_METADATA_MAX_BYTES + 64 * 1024;
function retainedProviderMetadata(value: PrivateProviderMetadata): PrivateProviderMetadata {
  return { mode: value.mode, ...(value.sessionId ? { sessionId: value.sessionId } : {}), ...(value.imageId ? { imageId: value.imageId } : {}), ...(value.eventId ? { eventId: value.eventId } : {}) };
}
export interface ProcessingProviderOptions {
  client: DewatermarkClient;
  media: PrivateMediaStore;
  ffprobePath?: string;
  now?: () => Date;
  id?: () => string;
  heartbeatIntervalMs?: number;
}

export class ProcessingProvider implements ProcessingWatermarkProvider {
  private readonly now: () => Date;
  private readonly id: () => string;
  constructor(private readonly options: ProcessingProviderOptions) { this.now = options.now ?? (() => new Date()); this.id = options.id ?? randomUUID; }

  private receiptKey(context: ProcessingProviderContext): string {
    if (!context.job.attempt) throw new Error('Processing attempt is missing');
    return `processing/provider-attempts/${safeMediaId(context.job.id)}/${safeMediaId(context.job.attempt.id)}.json`;
  }
  private async guarded<T>(context: ProcessingProviderContext, work: () => Promise<T>, retainLateResult = false): Promise<T> {
    let heartbeatError: unknown;
    let pending: Promise<void> | undefined;
    const timer = setInterval(() => {
      if (pending) return;
      pending = context.heartbeat().catch((error: unknown) => { heartbeatError = error; }).finally(() => { pending = undefined; });
    }, this.options.heartbeatIntervalMs ?? 15_000);
    timer.unref?.();
    try {
      const result = await work();
      if (pending) await pending;
      // An image response is already billed: preserve it as an immutable receipt
      // even after the lease was lost. The coordinator decides who may settle it.
      if (heartbeatError && !retainLateResult) throw heartbeatError;
      return result;
    } finally { clearInterval(timer); if (pending) await pending; }
  }
  private async validateInput(context: ProcessingProviderContext): Promise<Uint8Array | undefined> {
    const { input, mask, job } = context;
    if (input.ownerId !== job.ownerId || input.id !== job.inputArtifactId || !input.sealed || (job.operation === 'video-watermark' ? input.metadata.kind !== 'video' : input.metadata.kind !== 'image')) throw new DefinitiveProviderError('Input is not compatible with this operation');
    try {
      await this.options.media.verifyStored(input);
      if (mask) {
        if (mask.ownerId !== job.ownerId || mask.role !== 'mask' || mask.parentArtifactId !== input.id) throw new DefinitiveProviderError('Mask does not belong to the input');
        await this.options.media.verifyStored(mask);
        const bytes = await this.options.media.getBytes(mask.key, SITE_MAX_IMAGE_BYTES);
        await inspectMask(bytes, { width: input.metadata.width, height: input.metadata.height });
        return bytes;
      }
      return undefined;
    } catch (error) {
      if (error instanceof DefinitiveProviderError) throw error;
      throw new DefinitiveProviderError('Input could not be verified before processing');
    }
  }

  async submit(context: ProcessingProviderContext): Promise<ProviderOutcome> {
    if (context.job.attempt?.checkpoint?.providerJobId || context.job.attempt?.checkpoint?.stage === 'submitting') return this.poll(context);
    await context.heartbeat();
    const maskBytes = await this.guarded(context, () => this.validateInput(context));
    if (context.job.operation === 'video-watermark') return this.submitVideo(context, maskBytes);
    const mode = context.job.operation === 'image-watermark-pro' ? 'pro' : context.job.operation === 'image-refine' ? 'manual' : 'auto';
    let request: ImageRequest;
    if (mode === 'manual') {
      const metadata = await this.guarded(context, () => this.options.media.getJson<PrivateProviderMetadata>(`processing/provider-metadata/${safeMediaId(context.input.id)}.json`, PROVIDER_METADATA_MAX_BYTES));
      if (!maskBytes || context.input.role !== 'result' || Math.max(context.input.metadata.width, context.input.metadata.height) > 1920 || !context.input.providerSessionId || metadata?.sessionId !== context.input.providerSessionId || metadata.mode === 'pro') throw new DefinitiveProviderError('Refinement requires a supported result session and a maximum dimension of 1920 px');
      // Authorized provider acceptance on 2026-10-24 confirmed this exact shape.
      // The inferred base mask is neither sent nor newly persisted.
      const current = await this.guarded(context, () => this.options.media.getBytes(context.input.key, 48 * 1024 * 1024));
      request = { mode, image: current, sessionId: metadata.sessionId, maskBrush: maskBytes, removeText: false, predictMode: '4.0' };
    } else {
      request = await this.guarded(context, async () => {
        try {
          const source = await this.options.media.getBytes(context.input.key, 48 * 1024 * 1024);
          const prepared = await prepareImageForProvider(source, { maxBytes: 48 * 1024 * 1024, maxDimension: 6000 });
          return { mode, image: prepared.bytes, removeText: false, predictMode: '4.0' } satisfies ImageRequest;
        } catch { throw new DefinitiveProviderError('Image could not be prepared before processing'); }
      });
    }
    await context.heartbeat();
    await context.checkpoint({ stage: 'submitting' });
    try {
      const result = await this.guarded(context, () => this.options.client.processImage(request), true);
      const providerMetadata: PrivateProviderMetadata = { mode,
        ...(result.sessionId ? { sessionId: result.sessionId } : {}),
        ...(result.imageId ? { imageId: result.imageId } : {}), ...(result.eventId ? { eventId: result.eventId } : {}),
      };
      return await this.guarded(context, () => this.saveResult(context, result.image, 'image', providerMetadata), true);
    } catch (error) { this.chargedError(error); }
  }

  private async submitVideo(context: ProcessingProviderContext, maskBytes?: Uint8Array): Promise<ProviderOutcome> {
    await context.heartbeat();
    const upload = await this.beforeCharging(() => this.guarded(context, () => this.options.client.createVideoUpload()));
    await context.checkpoint({ providerJobId: upload.taskId, stage: 'upload-created' });
    const input = await this.guarded(context, () => this.options.media.getReadStream(context.input.key));
    if (input.byteSize !== context.input.metadata.byteSize || input.byteSize > SITE_MAX_VIDEO_BYTES) { await input.stream.cancel().catch(() => undefined); throw new DefinitiveProviderError('Video input size changed'); }
    await this.beforeCharging(() => this.guarded(context, () => this.options.client.uploadVideo(upload.uploadUrl, input.stream, input.byteSize)));
    await context.heartbeat();
    await context.checkpoint({ providerJobId: upload.taskId, stage: 'uploaded' });
    await context.checkpoint({ providerJobId: upload.taskId, stage: 'submitting' });
    try {
      await this.guarded(context, () => this.options.client.submitVideo({ taskId: upload.taskId, ...(maskBytes ? { maskBrush: maskBytes } : {}) }));
      await context.checkpoint({ providerJobId: upload.taskId, stage: 'processing' });
      return { status: 'processing', checkpoint: { providerJobId: upload.taskId, stage: 'processing' } };
    } catch (error) { this.chargedError(error); }
  }
  private async beforeCharging<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) {
      if (error instanceof DewatermarkRequestError && error.outcome === 'not-submitted') throw new DefinitiveProviderError('Video upload could not be completed before processing');
      throw error;
    }
  }

  private chargedError(error: unknown): never {
    if (error instanceof DewatermarkRequestError && error.outcome === 'rejected') throw new DefinitiveProviderError('Provider did not accept the processing request');
    if (error instanceof ProcessingError) throw new Error('Provider result needs reconciliation');
    throw error;
  }

  async poll(context: ProcessingProviderContext): Promise<ProviderOutcome> {
    const receipt = await this.guarded(context, () => this.options.media.getJson<ResultReceipt>(this.receiptKey(context), PROVIDER_RECEIPT_MAX_BYTES));
    if (receipt) return this.guarded(context, () => this.recoverReceipt(context, receipt), true);
    if (context.job.operation !== 'video-watermark') throw new Error('Image result is awaiting reconciliation');
    const taskId = context.job.attempt?.checkpoint?.providerJobId;
    if (!taskId) throw new Error('Video task identity is awaiting reconciliation');
    await context.heartbeat();
    const task = await this.guarded(context, () => this.options.client.getVideoTask(taskId));
    if (task.status === 'FAILED') return { status: 'failed', message: 'Video processing failed' };
    if (task.status !== 'COMPLETED') {
      // CREATED is not evidence of a safe-to-repeat submit after a lost response.
      if (task.status === 'CREATED' && context.job.attempt?.checkpoint?.stage !== 'processing') throw new Error('Video submission is awaiting reconciliation');
      return { status: 'processing', checkpoint: { providerJobId: taskId, stage: 'processing' }, ...(task.progress !== undefined ? { progress: task.progress } : {}) };
    }
    const result = await this.guarded(context, () => this.options.client.downloadResult(task.downloadUrl!), true);
    try { return await this.guarded(context, () => this.saveResult(context, result.bytes, 'video'), true); }
    catch { throw new Error('Provider result needs reconciliation'); }
  }

  private async saveResult(context: ProcessingProviderContext, bytes: Uint8Array, kind: 'image' | 'video', providerMetadata?: PrivateProviderMetadata): Promise<ProviderOutcome> {
    if (bytes.byteLength > (kind === 'video' ? SITE_MAX_VIDEO_BYTES : 48 * 1024 * 1024)) throw new Error('Provider output exceeds the site byte limit');
    if (kind === 'image') {
      // The product quote promises JPEG. Preserve dimensions and session/mask
      // coordinates; converting alpha to white never resizes the provider image.
      bytes = await sharp(bytes, { failOn: 'error', limitInputPixels: 40_000_000 }).rotate().flatten({ background: '#ffffff' }).jpeg({ quality: 95 }).toBuffer();
    }
    const metadata = await this.options.media.inspectBytes(bytes, kind, this.options.ffprobePath);
    if (kind === 'video') {
      const source = context.input.metadata;
      if (metadata.width !== source.width || metadata.height !== source.height || metadata.hasAudio !== source.hasAudio || !metadata.durationSeconds || !source.durationSeconds || Math.abs(metadata.durationSeconds - source.durationSeconds) > 0.25) throw new Error('Video output does not preserve the expected media properties');
    }
    const id = safeMediaId(this.id());
    const createdAt = this.now();
    const retainedMetadata = providerMetadata ? retainedProviderMetadata(providerMetadata) : undefined;
    const artifact: ProcessingArtifact = {
      id, ownerId: context.job.ownerId, key: mediaKey('result', context.job.ownerId, id, metadata.contentType), role: 'result', sealed: true,
      sha256: createHash('sha256').update(bytes).digest('hex'), metadata, parentArtifactId: context.input.id,
      ...(retainedMetadata?.sessionId ? { providerSessionId: retainedMetadata.sessionId } : {}),
      createdAt: createdAt.toISOString(), expiresAt: new Date(createdAt.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    };
    await this.options.media.putBytes(artifact.key, bytes, metadata.contentType, { 'owner-id': artifact.ownerId, 'artifact-id': id }, true);
    const receipt: ResultReceipt = { artifact, ...(retainedMetadata ? { providerMetadata: retainedMetadata } : {}) };
    await this.options.media.putJson(this.receiptKey(context), receipt, true);
    return this.recoverReceipt(context, receipt);
  }
  private async recoverReceipt(context: ProcessingProviderContext, receipt: ResultReceipt): Promise<ProviderOutcome> {
    if (receipt.artifact.ownerId !== context.job.ownerId || receipt.artifact.parentArtifactId !== context.input.id) throw new Error('Provider receipt ownership does not match');
    if (receipt.providerMetadata) await this.options.media.putJson(`processing/provider-metadata/${safeMediaId(receipt.artifact.id)}.json`, retainedProviderMetadata(receipt.providerMetadata));
    await this.options.media.create(receipt.artifact);
    await this.options.media.verifyStored(receipt.artifact);
    return { status: 'completed', artifact: receipt.artifact };
  }
}
