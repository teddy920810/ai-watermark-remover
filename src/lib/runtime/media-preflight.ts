import { createHash, randomUUID } from 'node:crypto';
import { inspectMask } from '../media/image';
import { validateVideoRequirements, type VideoInfo } from '../media/video';
import { ProcessingError, type ProcessingArtifact, type ProcessingInspector } from '../processing/contracts';
import { mediaKey, PrivateMediaStore, safeMediaId, SITE_MAX_IMAGE_BYTES, SITE_MAX_VIDEO_BYTES } from './private-media-store';

export interface UploadRecord {
  id: string;
  ownerId: string;
  stagingKey: string;
  inputKey: string;
  kind: 'image' | 'video' | 'mask';
  contentType: string;
  declaredByteSize: number;
  inputArtifactId?: string;
  status: 'created' | 'validating' | 'ready' | 'failed' | 'expired';
  artifactId?: string;
  error?: string;
  createdAt: string;
  expiresAt: string;
}
export interface MediaPreflightOptions { media: PrivateMediaStore; ffprobePath?: string; now?: () => Date; id?: () => string }

export class MediaPreflight implements ProcessingInspector {
  private readonly now: () => Date;
  private readonly id: () => string;
  constructor(private readonly options: MediaPreflightOptions) { this.now = options.now ?? (() => new Date()); this.id = options.id ?? randomUUID; }
  private async ownedUpload(ownerId: string, id: string): Promise<UploadRecord> {
    const record = await this.options.media.getJson<UploadRecord>(`processing/uploads/${safeMediaId(id)}.json`);
    if (!record || record.ownerId !== ownerId || record.id !== id) throw new ProcessingError('upload_not_found', 'Upload was not found', 404);
    return record;
  }
  async getUpload(ownerId: string, id: string): Promise<UploadRecord> {
    const record = await this.ownedUpload(ownerId, id);
    if (record.status === 'expired' || Date.parse(record.expiresAt) <= this.now().getTime() && record.status !== 'ready') throw new ProcessingError('upload_expired', 'Upload has expired; select the file again', 410);
    return record;
  }
  /** Internal delivery can read an expired record and persist its terminal state;
   * public polling still returns 410. A competing ready result is never replaced. */
  async getUploadForWorker(ownerId: string, id: string): Promise<UploadRecord> {
    let record = await this.ownedUpload(ownerId, id);
    if (record.status !== 'ready' && (record.status === 'expired' || Date.parse(record.expiresAt) <= this.now().getTime())) {
      record = await this.updateUpload(ownerId, id, (current) => ({ ...current, status: 'expired', error: 'upload_expired' }));
      if (record.status === 'expired') await this.options.media.delete(record.stagingKey).catch(() => undefined);
    }
    return record;
  }
  async createUpload(ownerId: string, input: { kind: 'image' | 'video' | 'mask'; contentType: string; byteSize: number; inputArtifactId?: string }): Promise<{ upload: UploadRecord; uploadUrl: string }> {
    const types = input.kind === 'video' ? ['video/mp4'] : input.kind === 'mask' ? ['image/png'] : ['image/jpeg', 'image/png', 'image/webp'];
    if (!ownerId || !['image', 'video', 'mask'].includes(input.kind) || !types.includes(input.contentType) || !Number.isSafeInteger(input.byteSize) || input.byteSize <= 0) throw new ProcessingError('invalid_upload', 'Invalid upload request');
    if (input.byteSize > (input.kind === 'video' ? SITE_MAX_VIDEO_BYTES : SITE_MAX_IMAGE_BYTES)) throw new ProcessingError('upload_too_large', input.kind === 'video' ? 'Video exceeds the site 100 MiB limit' : 'Image exceeds the site 10 MiB limit', 413);
    if (input.kind === 'mask') {
      const parent = input.inputArtifactId ? await this.options.media.get(input.inputArtifactId) : null;
      if (!parent || parent.ownerId !== ownerId || parent.role === 'mask') throw new ProcessingError('artifact_not_found', 'Input artifact was not found', 404);
    }
    const id = safeMediaId(this.id());
    const createdAt = this.now();
    const upload: UploadRecord = {
      id, ownerId, stagingKey: `processing/staging/${encodeURIComponent(ownerId)}/${id}`,
      inputKey: mediaKey(input.kind === 'mask' ? 'mask' : 'source', ownerId, id, input.contentType),
      kind: input.kind, contentType: input.contentType, declaredByteSize: input.byteSize,
      ...(input.inputArtifactId ? { inputArtifactId: input.inputArtifactId } : {}),
      status: 'created', createdAt: createdAt.toISOString(), expiresAt: new Date(createdAt.getTime() + 60 * 60 * 1000).toISOString(),
    };
    await this.options.media.putJson(`processing/uploads/${id}.json`, upload, true);
    return { upload, uploadUrl: await this.options.media.createUploadUrl(upload.stagingKey, input.contentType) };
  }
  async inspect(ownerId: string, uploadId: string): Promise<ProcessingArtifact> {
    const record = await this.getUploadForWorker(ownerId, uploadId);
    if (record.status === 'expired') throw new ProcessingError('upload_expired', 'Upload has expired; select the file again', 410);
    if (record.status === 'ready' && record.artifactId) {
      const artifact = await this.options.media.get(record.artifactId);
      if (!artifact || artifact.ownerId !== ownerId) throw new ProcessingError('artifact_not_found', 'Input artifact was not found', 404);
      return artifact;
    }
    const claimed = await this.updateUpload(ownerId, record.id, (current) => ({ ...current, status: 'validating' }));
    if (claimed.status === 'ready' && claimed.artifactId) return this.readyArtifact(ownerId, claimed.artifactId);
    let sealedKey: string | undefined;
    let registered = false;
    try {
      const head = await this.options.media.head(record.stagingKey);
      if (!head || head.byteSize !== record.declaredByteSize || head.contentType !== record.contentType) throw new ProcessingError('upload_mismatch', 'Uploaded media does not match its declaration');
      const id = safeMediaId(this.id());
      const role = record.kind === 'mask' ? 'mask' : 'source';
      // A fresh key on every attempt prevents a retry or concurrent preflight from
      // mutating an artifact that another request has already quoted.
      sealedKey = mediaKey(role, ownerId, id, record.contentType);
      await this.options.media.sealCopy(record.stagingKey, sealedKey, { 'owner-id': ownerId, 'artifact-id': id });
      const bytes = await this.options.media.getBytes(sealedKey, record.kind === 'video' ? SITE_MAX_VIDEO_BYTES : SITE_MAX_IMAGE_BYTES);
      if (bytes.byteLength !== record.declaredByteSize) throw new ProcessingError('upload_mismatch', 'Uploaded media does not match its declaration');
      const metadata = await this.options.media.inspectBytes(bytes, record.kind === 'video' ? 'video' : 'image', this.options.ffprobePath);
      if (metadata.contentType !== record.contentType) throw new ProcessingError('upload_mismatch', 'Uploaded media does not match its declaration');
      if (record.kind === 'video') validateVideoRequirements({ mimeType: 'video/mp4', width: metadata.width, height: metadata.height, durationSeconds: metadata.durationSeconds!, frameRate: metadata.fps!, videoCodec: metadata.codec!, audio: metadata.hasAudio ? [{ codec: 'present' }] : [] } satisfies VideoInfo);
      if (record.kind === 'mask') {
        const parent = record.inputArtifactId ? await this.options.media.get(record.inputArtifactId) : null;
        if (!parent || parent.ownerId !== ownerId) throw new ProcessingError('artifact_not_found', 'Input artifact was not found', 404);
        await this.options.media.verifyStored(parent);
        await inspectMask(bytes, { width: parent.metadata.width, height: parent.metadata.height });
      }
      const createdAt = this.now();
      const artifact: ProcessingArtifact = {
        id, ownerId, key: sealedKey, role, sealed: true, sha256: createHash('sha256').update(bytes).digest('hex'), metadata,
        createdAt: createdAt.toISOString(), expiresAt: new Date(createdAt.getTime() + 24 * 60 * 60 * 1000).toISOString(),
        ...(record.inputArtifactId ? { parentArtifactId: record.inputArtifactId } : {}),
      };
      await this.options.media.create(artifact);
      registered = true;
      await this.options.media.verifyStored(artifact);
      const completed = await this.updateUpload(ownerId, record.id, (current) => ({ ...current, inputKey: sealedKey!, status: 'ready', artifactId: id }));
      if (completed.status === 'expired') throw new ProcessingError('upload_expired', 'Upload has expired; select the file again', 410);
      await this.options.media.delete(record.stagingKey).catch(() => undefined);
      return completed.artifactId === id ? artifact : this.readyArtifact(ownerId, completed.artifactId!);
    } catch (error) {
      // A metadata write may have succeeded before its response was lost. Never
      // destroy registered immutable bytes or overwrite another worker's ready.
      if (sealedKey && !registered) await this.options.media.delete(sealedKey).catch(() => undefined);
      const message = error instanceof ProcessingError ? error.message : 'Media validation failed; select a compatible file';
      const failed = await this.updateUpload(ownerId, record.id, (current) => ({ ...current, status: 'failed', error: message }));
      if (failed.status === 'ready' && failed.artifactId) return this.readyArtifact(ownerId, failed.artifactId);
      if (failed.status === 'expired') throw new ProcessingError('upload_expired', 'Upload has expired; select the file again', 410);
      throw error instanceof ProcessingError ? error : new ProcessingError('invalid_media', message);
    }
  }
  private async readyArtifact(ownerId: string, id: string): Promise<ProcessingArtifact> {
    const artifact = await this.options.media.get(id);
    if (!artifact || artifact.ownerId !== ownerId) throw new ProcessingError('artifact_not_found', 'Input artifact was not found', 404);
    return artifact;
  }
  private async updateUpload(ownerId: string, id: string, update: (record: UploadRecord) => UploadRecord): Promise<UploadRecord> {
    const key = `processing/uploads/${safeMediaId(id)}.json`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await this.options.media.getVersionedJson<UploadRecord>(key);
      if (!current || current.value.ownerId !== ownerId) throw new ProcessingError('upload_not_found', 'Upload was not found', 404);
      if (current.value.status === 'ready' || current.value.status === 'expired') return current.value;
      const next = update(current.value);
      if (await this.options.media.compareAndSwapJson(key, current.version, next)) return next;
    }
    throw new ProcessingError('upload_conflict', 'Upload validation changed; retry its status', 409);
  }
}
