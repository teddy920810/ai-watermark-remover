import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { inspectImage } from '../media/image';
import { probeVideo } from '../media/video';
import { metadataSchema, ProcessingError, type MediaMetadata, type ProcessingArtifact, type ProcessingArtifactStore } from '../processing/contracts';

export const SITE_MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const SITE_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export type ObjectMetadata = Record<string, string>;
export type MediaSigner = typeof getSignedUrl;
const artifactSchema = z.object({
  id: z.string().min(1), ownerId: z.string().min(1), key: z.string(), role: z.enum(['source', 'mask', 'result']), sealed: z.literal(true),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), metadata: metadataSchema, createdAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
  parentArtifactId: z.string().optional(), providerSessionId: z.string().optional(),
});

export function safeMediaId(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw new ProcessingError('invalid_media_id', 'Invalid media identifier');
  return value;
}
function safeKey(key: string): string {
  if (!key.startsWith('processing/') || key.includes('\\') || key.includes('\0') || key.split('/').some((part) => !part || part === '.' || part === '..')) throw new ProcessingError('invalid_media_key', 'Invalid private media key');
  return key;
}
export function mediaKey(role: ProcessingArtifact['role'], ownerId: string, id: string, contentType: string): string {
  const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4' };
  const extension = extensions[contentType];
  if (!extension || !ownerId || ownerId.length > 512) throw new ProcessingError('invalid_media_type', 'Unsupported media type');
  const prefix = role === 'result' ? 'results' : role === 'mask' ? 'masks' : 'inputs';
  return `processing/${prefix}/${encodeURIComponent(ownerId)}/${safeMediaId(id)}.${extension}`;
}
function missing(error: unknown): boolean {
  const value = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return value?.name === 'NoSuchKey' || value?.name === 'NotFound' || value?.$metadata?.httpStatusCode === 404;
}
function conflict(error: unknown): boolean {
  return (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 412;
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
function bodyStream(body: unknown): ReadableStream<Uint8Array> {
  if (body instanceof ReadableStream) return body;
  const sdk = body as { transformToWebStream?: () => ReadableStream<Uint8Array>; [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array> };
  if (sdk?.transformToWebStream) return sdk.transformToWebStream();
  const iterator = sdk?.[Symbol.asyncIterator]?.();
  if (iterator) return new ReadableStream({
    async pull(controller) { const result = await iterator.next(); if (result.done) controller.close(); else controller.enqueue(new Uint8Array(result.value)); },
    async cancel() { await iterator.return?.(); },
  });
  throw new ProcessingError('invalid_media_body', 'Private media could not be read', 503);
}
async function readBytes(stream: ReadableStream<Uint8Array>, byteSize: number | undefined, maxBytes: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || (byteSize !== undefined && byteSize > maxBytes)) { await stream.cancel().catch(() => undefined); throw new ProcessingError('media_too_large', 'Media exceeds the byte limit', 413); }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel().catch(() => undefined); throw new ProcessingError('media_too_large', 'Media exceeds the byte limit', 413); }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ProcessingError) throw error;
    throw new ProcessingError('media_unreadable', 'Private media could not be read', 503);
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export interface PrivateMediaStoreOptions {
  client: Pick<S3Client, 'send'>;
  bucket: string;
  ffprobePath?: string;
  signUrl?: MediaSigner;
  now?: () => Date;
}
export class PrivateMediaStore implements ProcessingArtifactStore {
  private readonly now: () => Date;
  constructor(private readonly options: PrivateMediaStoreOptions) {
    if (!options.bucket) throw new Error('Private media bucket is required');
    this.now = options.now ?? (() => new Date());
  }
  async head(key: string): Promise<{ byteSize: number; contentType: string; metadata: ObjectMetadata; etag?: string } | null> {
    safeKey(key);
    try {
      const result = await this.options.client.send(new HeadObjectCommand({ Bucket: this.options.bucket, Key: key }));
      return { byteSize: result.ContentLength ?? 0, contentType: result.ContentType?.split(';')[0] ?? 'application/octet-stream', metadata: result.Metadata ?? {}, etag: result.ETag };
    } catch (error) {
      if (missing(error)) return null;
      throw new ProcessingError('storage_unavailable', 'Private media storage is unavailable', 503);
    }
  }
  async putBytes(key: string, bytes: Uint8Array, contentType: string, metadata: ObjectMetadata = {}, immutable = false): Promise<void> {
    safeKey(key);
    try { await this.options.client.send(new PutObjectCommand({ Bucket: this.options.bucket, Key: key, Body: bytes, ContentType: contentType, Metadata: metadata, ...(immutable ? { IfNoneMatch: '*' } : {}) })); }
    catch (error) {
      if (immutable && conflict(error)) throw error; // create() compares an existing immutable record.
      throw new ProcessingError('storage_unavailable', 'Private media storage is unavailable', 503);
    }
  }
  async getReadStream(key: string): Promise<{ stream: ReadableStream<Uint8Array>; byteSize?: number; contentType?: string; version?: string }> {
    safeKey(key);
    try {
      const result = await this.options.client.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: key }));
      return { stream: bodyStream(result.Body), byteSize: result.ContentLength, contentType: result.ContentType, version: result.ETag };
    } catch (error) {
      if (missing(error)) throw new ProcessingError('media_not_found', 'Private media was not found', 404);
      throw new ProcessingError('storage_unavailable', 'Private media storage is unavailable', 503);
    }
  }
  async getBytes(key: string, maxBytes = SITE_MAX_VIDEO_BYTES): Promise<Uint8Array> {
    const { stream, byteSize } = await this.getReadStream(key);
    return readBytes(stream, byteSize, maxBytes);
  }
  async putJson(key: string, value: unknown, immutable = false): Promise<void> {
    await this.putBytes(key, Buffer.from(JSON.stringify(value)), 'application/json', {}, immutable);
  }
  async getJson<T>(key: string, maxBytes = 1_048_576): Promise<T | null> {
    try { return JSON.parse(new TextDecoder().decode(await this.getBytes(key, maxBytes))) as T; }
    catch (error) { if (error instanceof ProcessingError && error.status === 404) return null; throw error; }
  }
  async getVersionedJson<T>(key: string): Promise<{ value: T; version: string } | null> {
    try {
      const result = await this.getReadStream(key);
      const bytes = await readBytes(result.stream, result.byteSize, 1_048_576);
      if (!result.version) throw new ProcessingError('storage_unavailable', 'Private metadata version is unavailable', 503);
      return { value: JSON.parse(new TextDecoder().decode(bytes)) as T, version: result.version };
    } catch (error) { if (error instanceof ProcessingError && error.status === 404) return null; throw error; }
  }
  async compareAndSwapJson(key: string, version: string, value: unknown): Promise<boolean> {
    safeKey(key);
    try {
      await this.options.client.send(new PutObjectCommand({ Bucket: this.options.bucket, Key: key, Body: Buffer.from(JSON.stringify(value)), ContentType: 'application/json', IfMatch: version }));
      return true;
    } catch (error) { if (conflict(error)) return false; throw new ProcessingError('storage_unavailable', 'Private metadata could not be updated', 503); }
  }
  async createUploadUrl(key: string, contentType: string, expiresIn = 900): Promise<string> {
    safeKey(key);
    if (!key.startsWith('processing/staging/') || !['image/jpeg', 'image/png', 'image/webp', 'video/mp4'].includes(contentType) || expiresIn <= 0 || expiresIn > 900) throw new ProcessingError('invalid_upload', 'Invalid upload request');
    return (this.options.signUrl ?? getSignedUrl)(this.options.client as S3Client, new PutObjectCommand({ Bucket: this.options.bucket, Key: key, ContentType: contentType }), { expiresIn });
  }
  async createDownloadUrl(key: string, filename = 'cleaned-media', expiresIn = 300): Promise<string> {
    safeKey(key);
    if (!/^processing\/(inputs|masks|results)\//.test(key) || !/^[A-Za-z0-9_.-]{1,160}$/.test(filename) || expiresIn <= 0 || expiresIn > 900) throw new ProcessingError('invalid_download', 'Invalid download request');
    return (this.options.signUrl ?? getSignedUrl)(this.options.client as S3Client, new GetObjectCommand({ Bucket: this.options.bucket, Key: key, ResponseContentDisposition: `attachment; filename="${filename}"`, ResponseCacheControl: 'private, no-store' }), { expiresIn });
  }
  async sealCopy(source: string, target: string, metadata: ObjectMetadata = {}): Promise<void> {
    safeKey(source); safeKey(target);
    if (!source.startsWith('processing/staging/') || !/^processing\/(inputs|masks)\//.test(target)) throw new ProcessingError('invalid_seal', 'Invalid media sealing request');
    const head = await this.head(source);
    if (!head?.etag) throw new ProcessingError('media_not_found', 'Uploaded media was not found', 404);
    if (await this.head(target)) throw new ProcessingError('immutable_media', 'Sealed media cannot be overwritten', 409);
    // Each invocation uses a fresh random artifact key. Bind the copy to the exact
    // staging version inspected here, never to bytes a browser may replace later.
    try { await this.options.client.send(new CopyObjectCommand({ Bucket: this.options.bucket, Key: target, CopySource: `${encodeURIComponent(this.options.bucket)}/${source.split('/').map(encodeURIComponent).join('/')}`, CopySourceIfMatch: head.etag, MetadataDirective: 'REPLACE', Metadata: metadata, ContentType: head.contentType })); }
    catch { throw new ProcessingError('storage_unavailable', 'Private media storage is unavailable', 503); }
  }
  async delete(key: string): Promise<void> {
    safeKey(key);
    try { await this.options.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key })); }
    catch { throw new ProcessingError('storage_unavailable', 'Private media storage is unavailable', 503); }
  }

  async get(id: string): Promise<ProcessingArtifact | null> {
    const value = await this.getJson<unknown>(`processing/artifacts/${safeMediaId(id)}.json`);
    if (value === null) return null;
    const parsed = artifactSchema.safeParse(value);
    if (!parsed.success || parsed.data.id !== id) throw new ProcessingError('invalid_artifact', 'Private artifact metadata is invalid', 503);
    return parsed.data;
  }
  async create(artifact: ProcessingArtifact): Promise<void> {
    const parsed = artifactSchema.safeParse(artifact);
    if (!parsed.success || artifact.key !== mediaKey(artifact.role, artifact.ownerId, artifact.id, artifact.metadata.contentType)) throw new ProcessingError('invalid_artifact', 'Private artifact metadata is invalid');
    try { await this.putJson(`processing/artifacts/${safeMediaId(artifact.id)}.json`, parsed.data, true); }
    catch (error) {
      if (error instanceof ProcessingError && error.status >= 500) throw error;
      if (!conflict(error) || stable(await this.get(artifact.id)) !== stable(parsed.data)) throw new ProcessingError('immutable_artifact', 'Artifact metadata cannot be overwritten', 409);
    }
  }
  async inspectBytes(bytes: Uint8Array, kind: 'image' | 'video', ffprobePath = this.options.ffprobePath): Promise<MediaMetadata> {
    if (kind === 'image') {
      const info = await inspectImage(bytes, { maxBytes: Math.max(SITE_MAX_IMAGE_BYTES, bytes.byteLength) });
      return { kind, contentType: info.mimeType, byteSize: bytes.byteLength, width: info.width, height: info.height };
    }
    if (!ffprobePath) throw new ProcessingError('video_probe_unavailable', 'Video inspection is not configured', 503);
    const directory = await mkdtemp(path.join(tmpdir(), 'watermark-media-'));
    try {
      const filename = path.join(directory, 'input.mp4');
      await writeFile(filename, bytes);
      const info = await probeVideo(filename, { ffprobePath });
      if (info.rotationDegrees) throw new ProcessingError('unsupported_video_rotation', 'Video rotation metadata is not supported');
      return { kind, contentType: info.mimeType, byteSize: bytes.byteLength, width: info.width, height: info.height, durationSeconds: info.durationSeconds, fps: info.frameRate, codec: info.videoCodec, hasAudio: info.audio.length > 0 };
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  async verifyStored(artifact: ProcessingArtifact): Promise<void> {
    const registered = await this.get(artifact.id);
    if (!registered || stable(registered) !== stable(artifact) || artifact.key !== mediaKey(artifact.role, artifact.ownerId, artifact.id, artifact.metadata.contentType) || Date.parse(artifact.expiresAt) <= this.now().getTime()) throw new ProcessingError('invalid_artifact', 'Private artifact is invalid or expired');
    const head = await this.head(artifact.key);
    if (!head || head.metadata['owner-id'] !== artifact.ownerId || head.metadata['artifact-id'] !== artifact.id || head.byteSize !== artifact.metadata.byteSize || head.contentType !== artifact.metadata.contentType) throw new ProcessingError('invalid_artifact', 'Private artifact ownership or metadata does not match');
    const maximum = artifact.metadata.kind === 'video' ? SITE_MAX_VIDEO_BYTES : 48 * 1024 * 1024;
    const bytes = await this.getBytes(artifact.key, maximum);
    if (createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) throw new ProcessingError('artifact_hash_mismatch', 'Private artifact checksum does not match');
    const actual = await this.inspectBytes(bytes, artifact.metadata.kind);
    if (stable(actual) !== stable(artifact.metadata)) throw new ProcessingError('artifact_metadata_mismatch', 'Private artifact dimensions or type do not match');
  }
}
