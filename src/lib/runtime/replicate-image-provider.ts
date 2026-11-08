import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { DefinitiveProviderError, type ProcessingArtifact } from '../processing/contracts';
import type { ProcessingProviderContext, WatermarkProvider, ProviderOutcome } from '../providers/watermark-provider';
import { mediaKey, PrivateMediaStore, readBytes, safeMediaId } from './private-media-store';
import { inspectMask } from '../media/image';

interface PredictionReceipt { id: string; ownerId: string; inputArtifactId: string }
const predictionSchema = z.object({ id: z.string().regex(/^[a-z0-9-]+$/i), status: z.enum(['starting', 'processing', 'succeeded', 'failed', 'canceled']), output: z.url().nullable().optional() });
type Prediction = z.infer<typeof predictionSchema>;
export interface ReplicateImageProviderOptions {
  media: PrivateMediaStore;
  operation: 'background-removal' | 'object-removal';
  config: { apiToken: string; baseUrl: string; modelVersion: string; timeoutMs: number; waitSeconds: number };
  request?: typeof fetch;
  now?: () => Date;
  id?: () => string;
}

/** Existing vendor request contract, with durable prediction/result receipts and no paid replay. */
export class ReplicateImageProvider implements WatermarkProvider {
  private readonly request: typeof fetch;
  private readonly now: () => Date;
  private readonly id: () => string;
  constructor(private readonly options: ReplicateImageProviderOptions) {
    this.request = options.request ?? fetch; this.now = options.now ?? (() => new Date()); this.id = options.id ?? randomUUID;
  }
  private key(context: ProcessingProviderContext, kind: 'predictions' | 'results') {
    if (!context.job.attempt) throw new Error('Processing attempt is missing');
    return `processing/provider-attempts/${safeMediaId(context.job.id)}/${safeMediaId(context.job.attempt.id)}/${kind}.json`;
  }
  private async guarded<T>(context: ProcessingProviderContext, work: () => Promise<T>): Promise<T> {
    let pending: Promise<void> | undefined;
    // A billed response still becomes a private receipt after lease loss. Only the Worker may settle it.
    const timer = setInterval(() => {
      if (!pending) pending = context.heartbeat().catch(() => {}).finally(() => { pending = undefined; });
    }, 15_000);
    timer.unref?.();
    try { return await work(); }
    finally { clearInterval(timer); if (pending) await pending; }
  }
  private async retainedPrediction(context: ProcessingProviderContext) {
    const receipt = await this.options.media.getJson<PredictionReceipt>(this.key(context, 'predictions'));
    if (receipt && (receipt.ownerId !== context.job.ownerId || receipt.inputArtifactId !== context.input.id || !/^[a-z0-9-]+$/i.test(receipt.id))) throw new Error('Prediction receipt ownership does not match');
    return receipt;
  }
  private async retainedResult(context: ProcessingProviderContext): Promise<ProviderOutcome | undefined> {
    const artifact = await this.options.media.getJson<ProcessingArtifact>(this.key(context, 'results'));
    if (!artifact) return undefined;
    if (artifact.ownerId !== context.job.ownerId || artifact.parentArtifactId !== context.input.id || artifact.metadata.contentType !== 'image/png') throw new Error('Result receipt ownership does not match');
    await this.options.media.create(artifact); await this.options.media.verifyStored(artifact);
    return { status: 'completed', artifact };
  }
  async submit(context: ProcessingProviderContext): Promise<ProviderOutcome> {
    if (context.job.attempt?.checkpoint?.stage === 'submitting' || context.job.attempt?.checkpoint?.providerJobId || await this.retainedPrediction(context)) return this.poll(context);
    if (context.job.operation !== this.options.operation || context.input.id !== context.job.inputArtifactId || context.input.ownerId !== context.job.ownerId || context.input.role === 'mask' || context.input.metadata.kind !== 'image' || !context.input.sealed) throw new DefinitiveProviderError('Input is not compatible with this operation');
    await context.heartbeat();
    try { await this.options.media.verifyStored(context.input); }
    catch { throw new DefinitiveProviderError('Input could not be verified before processing'); }
    const vendorInput = await this.vendorInput(context);
    await context.heartbeat(); await context.checkpoint({ provider: 'replicate', stage: 'submitting' });
    return this.guarded(context, async () => {
      // Preserve the original contract: https://replicate.com/851-labs/background-remover/api
      // Header, wait and asynchronous retrieval: https://replicate.com/docs/reference/http
      const endpoint = new URL('/v1/predictions', this.options.config.baseUrl);
      const response = await this.request(this.options.operation === 'object-removal' ? endpoint : endpoint.toString(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.config.apiToken}`,
          'Content-Type': 'application/json',
          Prefer: `wait=${this.options.config.waitSeconds}`,
          'Cancel-After': `${Math.ceil(this.options.config.timeoutMs / 1000)}s`,
        },
        body: JSON.stringify({
          version: `${this.options.operation === 'object-removal' ? 'allenhooo/lama' : '851-labs/background-remover'}:${this.options.config.modelVersion}`,
          input: vendorInput,
        }),
        signal: AbortSignal.timeout(this.options.config.timeoutMs),
      });
      if (!response.ok) {
        if ([400, 401, 402, 403, 404, 413, 422, 429].includes(response.status)) throw new DefinitiveProviderError('Provider did not accept the processing request');
        throw new Error('Provider submission needs reconciliation');
      }
      const prediction = predictionSchema.parse(await response.json());
      const receipt: PredictionReceipt = { id: prediction.id, ownerId: context.job.ownerId, inputArtifactId: context.input.id };
      await this.options.media.putJson(this.key(context, 'predictions'), receipt, true);
      // Finish retaining a synchronous billed result before a checkpoint can reject a lost lease.
      const outcome = await this.outcome(context, prediction);
      await context.checkpoint({ providerJobId: prediction.id, stage: 'processing' });
      return outcome;
    });
  }
  private async vendorInput(context: ProcessingProviderContext) {
    if (this.options.operation === 'background-removal') return { image: await this.options.media.createDownloadUrl(context.input.key, 'original-image', 900), format: 'png', reverse: false, threshold: 0, background_type: 'rgba' };
    // Preserve the original normalization and request contract: https://replicate.com/allenhooo/lama/api
    const mask = context.mask;
    if (!mask || !mask.sealed || mask.id !== context.job.maskArtifactId || mask.ownerId !== context.job.ownerId || mask.role !== 'mask' || mask.parentArtifactId !== context.input.id || mask.metadata.contentType !== 'image/png') throw new DefinitiveProviderError('Select an owned area on the current image');
    let imageBytes: Uint8Array; let maskBytes: Uint8Array;
    try {
      await this.options.media.verifyStored(mask);
      const image = await sharp(await this.options.media.getBytes(context.input.key)).rotate().png().toBuffer();
      const metadata = await sharp(image).metadata();
      if (metadata.width !== context.input.metadata.width || metadata.height !== context.input.metadata.height) throw new Error('Input dimensions changed');
      const sourceMask = await this.options.media.getBytes(mask.key);
      await inspectMask(sourceMask, { width: metadata.width!, height: metadata.height! });
      imageBytes = image; maskBytes = await sharp(sourceMask).greyscale().threshold(128).png().toBuffer();
    } catch { throw new DefinitiveProviderError('The source or selection could not be verified before processing'); }
    // Use the existing sealed private-media namespace and retention, including unknown responses.
    const retain = async (role: 'source' | 'mask', bytes: Uint8Array) => {
      const id = `provider-${createHash('sha256').update(`${context.job.id}:${context.job.attempt!.id}:${role}`).digest('hex')}`;
      const artifact: ProcessingArtifact = { id, ownerId: context.job.ownerId, key: mediaKey(role, context.job.ownerId, id, 'image/png'), role, sealed: true,
        sha256: createHash('sha256').update(bytes).digest('hex'), metadata: await this.options.media.inspectBytes(bytes, 'image'),
        parentArtifactId: context.input.id, createdAt: context.job.createdAt, expiresAt: context.input.expiresAt };
      await this.options.media.putBytes(artifact.key, bytes, 'image/png', { 'owner-id': artifact.ownerId, 'artifact-id': artifact.id });
      await this.options.media.create(artifact); await this.options.media.verifyStored(artifact);
      return artifact.key;
    };
    const [imageKey, maskKey] = await Promise.all([retain('source', imageBytes), retain('mask', maskBytes)]);
    const [image, selection] = await Promise.all([
      this.options.media.createDownloadUrl(imageKey, 'original-image.png', 900),
      this.options.media.createDownloadUrl(maskKey, 'selection.png', 900),
    ]);
    return { image, mask: selection };
  }
  async poll(context: ProcessingProviderContext): Promise<ProviderOutcome> {
    if (context.job.operation !== this.options.operation) throw new Error('Operation does not match this Provider');
    const result = await this.retainedResult(context); if (result) return result;
    const receipt = await this.retainedPrediction(context);
    const predictionId = receipt?.id ?? context.job.attempt?.checkpoint?.providerJobId;
    if (!predictionId || !/^[a-z0-9-]+$/i.test(predictionId)) throw new Error('Prediction identity is awaiting reconciliation; another submission is not allowed');
    await context.heartbeat();
    return this.guarded(context, async () => {
      const response = await this.request(new URL(`/v1/predictions/${predictionId}`, this.options.config.baseUrl), { headers: { Authorization: `Bearer ${this.options.config.apiToken}` }, signal: AbortSignal.timeout(this.options.config.timeoutMs) });
      if (!response.ok) throw new Error('Prediction is awaiting reconciliation');
      const prediction = predictionSchema.parse(await response.json());
      if (prediction.id !== predictionId) throw new Error('Prediction identity does not match');
      return this.outcome(context, prediction);
    });
  }
  private async outcome(context: ProcessingProviderContext, prediction: Prediction): Promise<ProviderOutcome> {
    if (prediction.status === 'failed' || prediction.status === 'canceled') return { status: 'failed', message: 'Image processing failed' };
    if (prediction.status !== 'succeeded') return { status: 'processing', checkpoint: { providerJobId: prediction.id, stage: 'processing' } };
    if (!prediction.output) throw new Error('Provider output is awaiting reconciliation');
    const url = new URL(prediction.output);
    if (url.protocol !== 'https:' || !(url.hostname === 'replicate.delivery' || url.hostname.endsWith('.replicate.delivery'))) throw new Error('Provider output location is invalid');
    const response = await this.request(prediction.output, { signal: AbortSignal.timeout(this.options.config.timeoutMs) });
    if (!response.ok || !response.body) throw new Error('Provider output could not be retrieved');
    const declared = response.headers.get('Content-Length');
    let bytes = await readBytes(response.body, declared ? Number(declared) : undefined, 25 * 1024 * 1024);
    const info = await sharp(bytes, { failOn: 'error', limitInputPixels: 40_000_000 }).metadata();
    if (info.format !== 'png' || info.width !== context.input.metadata.width || info.height !== context.input.metadata.height) throw new Error('Provider output format or dimensions do not match');
    if (this.options.operation === 'background-removal') bytes = await sharp(bytes).ensureAlpha().png().toBuffer();
    const metadata = await this.options.media.inspectBytes(bytes, 'image'); const id = safeMediaId(this.id()); const created = this.now();
    const artifact: ProcessingArtifact = { id, ownerId: context.job.ownerId, key: mediaKey('result', context.job.ownerId, id, 'image/png'), role: 'result', sealed: true, parentArtifactId: context.input.id, sha256: createHash('sha256').update(bytes).digest('hex'), metadata, createdAt: created.toISOString(), expiresAt: new Date(created.getTime() + 86_400_000).toISOString() };
    await this.options.media.putBytes(artifact.key, bytes, 'image/png', { 'owner-id': artifact.ownerId, 'artifact-id': artifact.id }, true);
    await this.options.media.putJson(this.key(context, 'results'), artifact, true);
    return (await this.retainedResult(context))!;
  }
}
