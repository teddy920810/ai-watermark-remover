import type { S3Client } from '@aws-sdk/client-s3';
import { vi } from 'vitest';
import { PrivateMediaStore } from './private-media-store';

export function memoryMediaStore() {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string; metadata: Record<string, string>; etag: string }>();
  let version = 0;
  const send = vi.fn(async (command: { input: unknown; constructor: { name: string } }) => {
    const input = command.input as Record<string, unknown>;
    const key = String(input.Key);
    const existing = objects.get(key);
    const missing = () => Object.assign(new Error('Missing'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
    if (command.constructor.name === 'PutObjectCommand') {
      if (existing && input.IfNoneMatch === '*') throw Object.assign(new Error('Precondition'), { $metadata: { httpStatusCode: 412 } });
      if (input.IfMatch && existing?.etag !== input.IfMatch) throw Object.assign(new Error('Precondition'), { $metadata: { httpStatusCode: 412 } });
      const bytes = input.Body instanceof Uint8Array ? input.Body : Buffer.from(String(input.Body));
      objects.set(key, { bytes, contentType: String(input.ContentType), metadata: (input.Metadata ?? {}) as Record<string, string>, etag: `etag-${++version}` });
      return { ETag: objects.get(key)?.etag };
    }
    if (command.constructor.name === 'GetObjectCommand') {
      if (!existing) throw missing();
      return { ContentLength: existing.bytes.byteLength, ContentType: existing.contentType, Metadata: existing.metadata, ETag: existing.etag, Body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(existing.bytes); controller.close(); } }) };
    }
    if (command.constructor.name === 'HeadObjectCommand') {
      if (!existing) throw missing();
      return { ContentLength: existing.bytes.byteLength, ContentType: existing.contentType, Metadata: existing.metadata, ETag: existing.etag };
    }
    if (command.constructor.name === 'CopyObjectCommand') {
      const sourceKey = String(input.CopySource).split('/').slice(1).map(decodeURIComponent).join('/');
      const source = objects.get(sourceKey);
      if (!source || source.etag !== input.CopySourceIfMatch) throw missing();
      objects.set(key, { ...source, bytes: new Uint8Array(source.bytes), metadata: (input.Metadata ?? {}) as Record<string, string>, etag: `etag-${++version}` });
      return {};
    }
    if (command.constructor.name === 'DeleteObjectCommand') { objects.delete(key); return {}; }
    throw new Error(`Unexpected ${command.constructor.name}`);
  });
  const signUrl = vi.fn(async () => 'https://r2.example.test/signed');
  const media = new PrivateMediaStore({ client: { send } as unknown as Pick<S3Client, 'send'>, bucket: 'private-bucket', signUrl, now: () => new Date('2026-10-24T00:00:00.000Z') });
  return { media, objects, send, signUrl };
}
