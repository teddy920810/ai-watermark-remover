import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { ProcessingArtifact } from '../processing/contracts';
import { mediaKey } from './private-media-store';
import { memoryMediaStore } from './test-fixtures';

async function artifactFixture(ownerId = 'owner-1') {
  const bytes = await sharp({ create: { width: 2, height: 3, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const artifact: ProcessingArtifact = { id: 'artifact-1', ownerId, key: mediaKey('source', ownerId, 'artifact-1', 'image/png'), role: 'source', sealed: true, sha256: createHash('sha256').update(bytes).digest('hex'), metadata: { kind: 'image', contentType: 'image/png', byteSize: bytes.byteLength, width: 2, height: 3 }, createdAt: '2026-10-24T00:00:00.000Z', expiresAt: '2026-10-25T00:00:00.000Z' };
  return { bytes, artifact };
}

describe('private R2 media and artifact store', () => {
  it('persists immutable artifact metadata and verifies actual private bytes before settlement', async () => {
    const { media, objects } = memoryMediaStore();
    const { artifact, bytes } = await artifactFixture();
    await media.putBytes(artifact.key, bytes, 'image/png', { 'owner-id': artifact.ownerId, 'artifact-id': artifact.id });
    await media.create(artifact);
    expect(objects.has('processing/artifacts/artifact-1.json')).toBe(true);
    expect(await media.get(artifact.id)).toEqual(artifact);
    await expect(media.create(artifact)).resolves.toBeUndefined();
    await expect(media.create({ ...artifact, metadata: { ...artifact.metadata, width: 99 } })).rejects.toMatchObject({ code: 'immutable_artifact', status: 409 });
    await expect(media.verifyStored(artifact)).resolves.toBeUndefined();
    await expect(media.create({ ...artifact, ownerId: 'other' })).rejects.toThrow();
  });
  it('rejects forged ownership, paths, hashes and actual dimensions', async () => {
    const { media } = memoryMediaStore();
    const { artifact, bytes } = await artifactFixture();
    await media.putBytes(artifact.key, bytes, 'image/png', { 'owner-id': artifact.ownerId, 'artifact-id': artifact.id });
    await media.create(artifact);
    for (const forged of [
      { ...artifact, ownerId: 'other' }, { ...artifact, key: 'results/legacy.jpg' },
      { ...artifact, sha256: 'f'.repeat(64) }, { ...artifact, metadata: { ...artifact.metadata, width: 99 } },
    ]) await expect(media.verifyStored(forged)).rejects.toThrow();
    await media.putBytes(artifact.key, new Uint8Array([1, 2]), 'image/png', { 'owner-id': artifact.ownerId, 'artifact-id': artifact.id });
    await expect(media.verifyStored(artifact)).rejects.toThrow();
  });
  it('signs constrained upload/download commands without public ACL or credential exposure', async () => {
    const { media, signUrl } = memoryMediaStore();
    await media.createUploadUrl('processing/staging/owner-1/upload-1', 'video/mp4', 600);
    const upload = signUrl.mock.calls[0] as unknown[];
    expect((upload[1] as { input: unknown }).input).toMatchObject({ Bucket: 'private-bucket', Key: 'processing/staging/owner-1/upload-1', ContentType: 'video/mp4' });
    expect(upload[2]).toEqual({ expiresIn: 600 });
    await media.createDownloadUrl('processing/results/owner-1/artifact-1.mp4', 'cleaned.mp4');
    expect((signUrl.mock.calls[1] as unknown[])[1]).toMatchObject({ input: { ResponseContentDisposition: 'attachment; filename="cleaned.mp4"' } });
    await expect(media.createUploadUrl('processing/inputs/owner-1/immutable.jpg', 'image/jpeg')).rejects.toThrow();
    await expect(media.getBytes('../outside')).rejects.toThrow();
  });
  it('copies a version-bound staging object to a browser-unwritable private input and deletes staging', async () => {
    const { media, send } = memoryMediaStore();
    await media.putBytes('processing/staging/owner-1/upload-1', new Uint8Array([1, 2]), 'image/png');
    await media.sealCopy('processing/staging/owner-1/upload-1', 'processing/inputs/owner-1/artifact-1.png', { 'owner-id': 'owner-1', 'artifact-id': 'artifact-1' });
    const copy = send.mock.calls.find(([command]) => command.constructor.name === 'CopyObjectCommand')?.[0] as unknown as { input: unknown };
    expect(copy.input).toMatchObject({ CopySource: 'private-bucket/processing/staging/owner-1/upload-1', CopySourceIfMatch: 'etag-1', MetadataDirective: 'REPLACE', Metadata: { 'owner-id': 'owner-1', 'artifact-id': 'artifact-1' } });
    await expect(media.getBytes('processing/inputs/owner-1/artifact-1.png', 1)).rejects.toThrow('Media exceeds the byte limit');
    await media.delete('processing/staging/owner-1/upload-1');
    expect(await media.head('processing/staging/owner-1/upload-1')).toBeNull();
  });
  it.each(['put', 'copy', 'delete', 'create'] as const)('keeps a temporary %s outage retryable and redacts SDK details', async (operation) => {
    const { media, send } = memoryMediaStore();
    const { artifact, bytes } = await artifactFixture();
    const staging = 'processing/staging/owner-1/upload-1';
    await media.putBytes(staging, bytes, 'image/png');
    const target = operation === 'copy' ? 'CopyObjectCommand' : operation === 'delete' ? 'DeleteObjectCommand' : 'PutObjectCommand';
    const original = send.getMockImplementation()!;
    send.mockImplementation(async (command) => {
      if (command.constructor.name === target) throw new Error('private upstream credential diagnostic');
      return original(command);
    });
    const work = operation === 'put' ? () => media.putBytes(artifact.key, bytes, 'image/png') : operation === 'copy' ? () => media.sealCopy(staging, artifact.key) : operation === 'delete' ? () => media.delete(staging) : () => media.create(artifact);
    await expect(work()).rejects.toMatchObject({ code: 'storage_unavailable', status: 503, message: 'Private media storage is unavailable' });
  });
});
