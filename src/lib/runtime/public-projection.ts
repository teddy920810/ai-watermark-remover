import { ProcessingError } from '../processing/contracts';
import type { MediaMetadata, ProcessingArtifact, ProcessingArtifactStore, ProcessingJob, ProcessingQuote } from '../processing/contracts';
import { mediaKey } from './private-media-store';

export interface PublicArtifact extends MediaMetadata {
  id: string;
  role: ProcessingArtifact['role'];
  metadata: MediaMetadata;
  format: string;
  expiresAt: string;
  previewUrl?: string;
  expired: boolean;
  canRefine?: boolean;
}
export interface PublicProjectionOptions {
  media: Pick<ProcessingArtifactStore, 'get'> & {
    head(key: string): Promise<{ byteSize: number; contentType: string; metadata: Record<string, string> } | null>;
    createDownloadUrl(key: string, filename?: string, expiresIn?: number): Promise<string>;
  };
  signPreview(artifact: ProcessingArtifact, expiresIn: number): Promise<string>;
  now?: () => Date;
  refinementEnabled?: boolean;
  isDemo?: boolean;
}
const errors: Record<string, string> = {
  provider_request_uncertain: 'The request status is being confirmed. Do not start another operation.',
  unknown_timeout: 'The confirmation deadline passed and the reserved allowance was returned.',
  dispatch_timeout: 'The task did not start before the deadline. The reserved allowance was returned. Review the cost to try again.',
  processing_failed: 'Processing failed. The reserved allowance was returned.',
  result_recovery_pending: 'Processing finished. The result is being recovered without processing again.',
};
function publicMetadata(value: MediaMetadata): MediaMetadata {
  return { kind: value.kind, contentType: value.contentType, byteSize: value.byteSize, width: value.width, height: value.height,
    ...(value.durationSeconds !== undefined ? { durationSeconds: value.durationSeconds } : {}), ...(value.fps !== undefined ? { fps: value.fps } : {}),
    ...(value.codec !== undefined ? { codec: value.codec } : {}), ...(value.hasAudio !== undefined ? { hasAudio: value.hasAudio } : {}) };
}
function format(type: string): string { return ({ 'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/webp': 'WebP', 'video/mp4': 'MP4' } as Record<string, string>)[type] ?? 'File'; }

/** Only explicitly selected fields leave the server. Never spread private records. */
export class PublicProcessingProjection {
  private readonly now: () => Date;
  constructor(private readonly options: PublicProjectionOptions) { this.now = options.now ?? (() => new Date()); }
  private owned(ownerId: string, artifact: ProcessingArtifact): void {
    if (artifact.ownerId !== ownerId || !artifact.sealed || artifact.key !== mediaKey(artifact.role, ownerId, artifact.id, artifact.metadata.contentType)) throw new ProcessingError('artifact_not_found', 'File was not found', 404);
  }
  async artifact(ownerId: string, artifact: ProcessingArtifact, canRefine = false): Promise<PublicArtifact> {
    this.owned(ownerId, artifact);
    const expired = Date.parse(artifact.expiresAt) <= this.now().getTime();
    const seconds = Math.min(300, Math.floor((Date.parse(artifact.expiresAt) - this.now().getTime()) / 1000));
    const metadata = publicMetadata(artifact.metadata);
    return { id: artifact.id, role: artifact.role, ...metadata, metadata, format: format(metadata.contentType), expiresAt: artifact.expiresAt, expired,
      ...(seconds > 0 ? { previewUrl: await this.options.signPreview(artifact, seconds) } : {}), canRefine: !expired && canRefine };
  }
  async quote(ownerId: string, quote: ProcessingQuote) {
    if (quote.ownerId !== ownerId) throw new ProcessingError('not_found', 'Quote was not found', 404);
    const input = await this.options.media.get(quote.inputArtifactId);
    if (!input) throw new ProcessingError('artifact_not_found', 'Input was not found', 404);
    this.owned(ownerId, input);
    const video = quote.operation === 'video-watermark';
    return { id: quote.id, operation: quote.operation, inputArtifactId: quote.inputArtifactId,
      ...(quote.maskArtifactId ? { maskArtifactId: quote.maskArtifactId } : {}), ...(quote.parentJobId ? { parentJobId: quote.parentJobId } : {}),
      amount: quote.amount, unit: quote.unit, priceVersion: quote.priceVersion, createdAt: quote.createdAt, expiresAt: quote.expiresAt,
      isDemo: this.options.isDemo ?? false,
      expectedOutput: { contentType: video ? 'video/mp4' : 'image/jpeg', format: video ? 'MP4' : 'JPG', width: input.metadata.width, height: input.metadata.height,
        ...(video ? { durationSeconds: input.metadata.durationSeconds, fps: input.metadata.fps, hasAudio: input.metadata.hasAudio } : { transparent: false, background: 'white' }) } };
  }
  async job(ownerId: string, job: ProcessingJob) {
    if (job.ownerId !== ownerId) throw new ProcessingError('not_found', 'Task was not found', 404);
    const input = await this.options.media.get(job.inputArtifactId);
    const result = job.resultArtifactId ? await this.options.media.get(job.resultArtifactId) : null;
    const deadline = result && job.expiresAt ? new Date(Math.min(Date.parse(job.expiresAt), Date.parse(result.expiresAt))).toISOString() : job.expiresAt;
    const expired = Boolean(deadline && Date.parse(deadline) <= this.now().getTime());
    const canRefine = Boolean(!expired && this.options.refinementEnabled && job.status === 'READY' && job.operation !== 'image-watermark-pro' && job.operation !== 'video-watermark' && result?.providerSessionId && result.metadata.kind === 'image' && Math.max(result.metadata.width, result.metadata.height) <= 1920);
    const code = job.error && errors[job.error] ? job.error : job.error ? 'processing_failed' : undefined;
    return { id: job.id, operation: job.operation, status: job.status === 'READY' && expired ? 'EXPIRED' : job.status, chargeStatus: job.chargeStatus, charge: { status: job.chargeStatus, amount: job.quote.amount, unit: job.quote.unit },
      amount: job.quote.amount, unit: job.quote.unit, quote: { id: job.quote.id, amount: job.quote.amount, unit: job.quote.unit },
      createdAt: job.createdAt, updatedAt: job.updatedAt, ...(deadline ? { expiresAt: deadline } : {}),
      ...(job.parentJobId ? { parentJobId: job.parentJobId } : {}),
      ...(typeof job.progress === 'number' && Number.isFinite(job.progress) && job.progress >= 0 && job.progress <= 1 ? { progress: job.progress } : {}),
      ...(input ? { input: await this.artifact(ownerId, input) } : {}), ...(result ? { result: await this.artifact(ownerId, deadline ? { ...result, expiresAt: deadline } : result, canRefine) } : {}),
      ...(code ? { errorCode: code, error: errors[code] } : {}), isDemo: this.options.isDemo ?? false };
  }
  async download(ownerId: string, job: ProcessingJob) {
    if (job.ownerId !== ownerId) throw new ProcessingError('not_found', 'Task was not found', 404);
    if (job.status !== 'READY' || !job.resultArtifactId) throw new ProcessingError('result_not_ready', 'The result is not ready to download', 409);
    const artifact = await this.options.media.get(job.resultArtifactId);
    if (!artifact || artifact.role !== 'result') throw new ProcessingError('result_expired', 'The result is no longer available', 410);
    this.owned(ownerId, artifact);
    const deadline = Math.min(Date.parse(artifact.expiresAt), job.expiresAt ? Date.parse(job.expiresAt) : Infinity);
    const ttl = Math.min(300, Math.floor((deadline - this.now().getTime()) / 1000));
    if (ttl < 1) throw new ProcessingError('result_expired', 'The result reached its retention limit', 410);
    const head = await this.options.media.head(artifact.key);
    if (!head || head.byteSize !== artifact.metadata.byteSize || head.contentType !== artifact.metadata.contentType || head.metadata['owner-id'] !== ownerId || head.metadata['artifact-id'] !== artifact.id) throw new ProcessingError('result_expired', 'The result is no longer available', 410);
    const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4' } as Record<string, string>)[artifact.metadata.contentType];
    const filename = artifact.metadata.kind === 'video' ? 'cleaned-video.mp4' : `cleaned-image.${extension ?? 'jpg'}`;
    const url = await this.options.media.createDownloadUrl(artifact.key, filename, ttl);
    return { url, downloadUrl: url, filename, expiresAt: new Date(this.now().getTime() + ttl * 1000).toISOString(), artifactId: artifact.id };
  }
}
