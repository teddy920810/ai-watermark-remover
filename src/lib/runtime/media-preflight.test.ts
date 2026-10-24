import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { MediaPreflight } from './media-preflight';
import { memoryMediaStore } from './test-fixtures';

function fixture() {
  const memory = memoryMediaStore();
  let sequence = 0;
  const preflight = new MediaPreflight({ media: memory.media, now: () => new Date('2026-10-24T00:00:00.000Z'), id: () => `id-${++sequence}` });
  return { ...memory, preflight };
}
const png = () => sharp({ create: { width: 4, height: 2, channels: 3, background: '#ffffff' } }).png().toBuffer();

describe('non-billable sealed media preflight', () => {
  it('terminates an expired unvalidated upload internally while preserving public 410 and owner boundaries', async () => {
    const { media, preflight } = fixture(); const { upload } = await preflight.createUpload('owner-1', { kind: 'image', contentType: 'image/png', byteSize: 3 });
    await media.putBytes(upload.stagingKey, new Uint8Array([1, 2, 3]), 'image/png');
    const later = new MediaPreflight({ media, now: () => new Date('2026-10-24T01:00:01.000Z') });
    await expect(later.getUploadForWorker('other', upload.id)).rejects.toMatchObject({ status: 404 });
    expect(await later.getUploadForWorker('owner-1', upload.id)).toMatchObject({ status: 'expired', error: 'upload_expired' });
    await expect(later.getUpload('owner-1', upload.id)).rejects.toMatchObject({ code: 'upload_expired', status: 410 });
    expect(await media.head(upload.stagingKey)).toBeNull();
    await expect(later.inspect('owner-1', upload.id)).rejects.toMatchObject({ code: 'upload_expired', status: 410 });
  });
  it('keeps a completed artifact readable after the upload deadline and cannot revive an expired in-flight inspection', async () => {
    const { media, preflight } = fixture(); const bytes = await png();
    const first = await preflight.createUpload('owner-1', { kind: 'image', contentType: 'image/png', byteSize: bytes.byteLength }); await media.putBytes(first.upload.stagingKey, bytes, 'image/png');
    const artifact = await preflight.inspect('owner-1', first.upload.id);
    const later = new MediaPreflight({ media, now: () => new Date('2026-10-24T01:00:01.000Z') });
    expect(await later.getUploadForWorker('owner-1', first.upload.id)).toMatchObject({ status: 'ready', artifactId: artifact.id });
    expect(await later.getUpload('owner-1', first.upload.id)).toMatchObject({ status: 'ready' });
    const second = await preflight.createUpload('owner-1', { kind: 'image', contentType: 'image/png', byteSize: bytes.byteLength }); await media.putBytes(second.upload.stagingKey, bytes, 'image/png');
    let resume!: () => void; const wait = new Promise<void>((resolve) => { resume = resolve; }); const original = media.inspectBytes.bind(media);
    const inspect = vi.spyOn(media, 'inspectBytes').mockImplementationOnce(async (...args) => { await wait; return original(...args); });
    const running = preflight.inspect('owner-1', second.upload.id); const outcome = running.then(() => null, (error: unknown) => error);
    try {
      await vi.waitFor(() => expect(inspect).toHaveBeenCalledTimes(1));
      expect(await later.getUploadForWorker('owner-1', second.upload.id)).toMatchObject({ status: 'expired' }); resume();
      expect(await outcome).toMatchObject({ code: 'upload_expired', status: 410 });
      const terminal = await later.getUploadForWorker('owner-1', second.upload.id);
      expect(terminal.status).toBe('expired'); expect(terminal.artifactId).toBeUndefined();
    } finally { resume(); await outcome; }
  });
  it('seals and verifies image bytes, creates an owned artifact, then removes writable staging', async () => {
    const { preflight, media } = fixture();
    const bytes = await png();
    const { upload } = await preflight.createUpload('owner-1', { kind: 'image', contentType: 'image/png', byteSize: bytes.byteLength });
    await media.putBytes(upload.stagingKey, bytes, 'image/png');
    const artifact = await preflight.inspect('owner-1', upload.id);
    expect(artifact).toMatchObject({ ownerId: 'owner-1', sealed: true, role: 'source', metadata: { kind: 'image', contentType: 'image/png', width: 4, height: 2 } });
    expect(artifact.key).toMatch(/^processing\/inputs\/owner-1\//);
    expect(await media.head(upload.stagingKey)).toBeNull();
    expect(await preflight.getUpload('owner-1', upload.id)).toMatchObject({ status: 'ready', artifactId: artifact.id });
    await expect(preflight.inspect('owner-1', upload.id)).resolves.toEqual(artifact);
  });
  it('rejects wrong owner, head mismatch and disguised file content without creating a ready artifact', async () => {
    const { preflight, media } = fixture();
    const bytes = await png();
    const { upload } = await preflight.createUpload('owner-1', { kind: 'image', contentType: 'image/png', byteSize: bytes.byteLength });
    await expect(preflight.inspect('other', upload.id)).rejects.toMatchObject({ status: 404 });
    await media.putBytes(upload.stagingKey, new Uint8Array([1]), 'image/png');
    await expect(preflight.inspect('owner-1', upload.id)).rejects.toThrow('Uploaded media does not match its declaration');
    expect(await preflight.getUpload('owner-1', upload.id)).toMatchObject({ status: 'failed' });
    const { upload: invalid } = await preflight.createUpload('owner-1', { kind: 'image', contentType: 'image/png', byteSize: 4 });
    await media.putBytes(invalid.stagingKey, new Uint8Array([1, 2, 3, 4]), 'image/png');
    await expect(preflight.inspect('owner-1', invalid.id)).rejects.toThrow();
  });
  it('applies the site 100MiB video ceiling before upload signing without inventing a vendor size limit', async () => {
    const { preflight, signUrl } = fixture();
    await expect(preflight.createUpload('owner-1', { kind: 'video', contentType: 'video/mp4', byteSize: 100 * 1024 * 1024 + 1 })).rejects.toThrow('Video exceeds the site 100 MiB limit');
    expect(signUrl).not.toHaveBeenCalled();
  });
  it('binds masks to the owned input dimensions and rejects wrong or empty selections', async () => {
    const { preflight, media } = fixture();
    const bytes = await png();
    const sourceUpload = await preflight.createUpload('owner-1', { kind: 'image', contentType: 'image/png', byteSize: bytes.byteLength });
    await media.putBytes(sourceUpload.upload.stagingKey, bytes, 'image/png');
    const source = await preflight.inspect('owner-1', sourceUpload.upload.id);
    const mask = await sharp(Buffer.from([255, 0, 0, 0, 0, 0, 0, 0]), { raw: { width: 4, height: 2, channels: 1 } }).png().toBuffer();
    const maskUpload = await preflight.createUpload('owner-1', { kind: 'mask', contentType: 'image/png', byteSize: mask.byteLength, inputArtifactId: source.id });
    await media.putBytes(maskUpload.upload.stagingKey, mask, 'image/png');
    const artifact = await preflight.inspect('owner-1', maskUpload.upload.id);
    expect(artifact).toMatchObject({ role: 'mask', parentArtifactId: source.id, metadata: { width: 4, height: 2 } });
    await expect(preflight.createUpload('other', { kind: 'mask', contentType: 'image/png', byteSize: mask.byteLength, inputArtifactId: source.id })).rejects.toMatchObject({ status: 404 });
  });
  it('does not destroy a ready artifact when staging cleanup temporarily fails', async () => {
    const { preflight, media } = fixture();
    const bytes = await png();
    const { upload } = await preflight.createUpload('owner-1', { kind: 'image', contentType: 'image/png', byteSize: bytes.byteLength });
    await media.putBytes(upload.stagingKey, bytes, 'image/png');
    vi.spyOn(media, 'delete').mockRejectedValueOnce(new Error('cleanup unavailable'));
    const artifact = await preflight.inspect('owner-1', upload.id);
    expect(await preflight.getUpload('owner-1', upload.id)).toMatchObject({ status: 'ready', artifactId: artifact.id });
    await expect(media.verifyStored(artifact)).resolves.toBeUndefined();
  });
  it('checks mask ownership at upload signing but leaves actual probing in the worker', async () => {
    const { preflight, media } = fixture();
    const bytes = await png();
    const initial = await preflight.createUpload('owner-1', { kind: 'image', contentType: 'image/png', byteSize: bytes.byteLength });
    await media.putBytes(initial.upload.stagingKey, bytes, 'image/png');
    const artifact = await preflight.inspect('owner-1', initial.upload.id);
    const verify = vi.spyOn(media, 'verifyStored').mockRejectedValue(new Error('Probe must not run in API'));
    await expect(preflight.createUpload('owner-1', { kind: 'mask', contentType: 'image/png', byteSize: bytes.byteLength, inputArtifactId: artifact.id })).resolves.toMatchObject({ upload: { status: 'created' } });
    expect(verify).not.toHaveBeenCalled();
  });
  it('updates upload records with ETag conditions so concurrent work cannot overwrite ready', async () => {
    const { preflight, media, send } = fixture();
    const bytes = await png();
    const { upload } = await preflight.createUpload('owner-1', { kind: 'image', contentType: 'image/png', byteSize: bytes.byteLength });
    await media.putBytes(upload.stagingKey, bytes, 'image/png');
    await preflight.inspect('owner-1', upload.id);
    const updates = send.mock.calls.map(([command]) => command).filter((command) => command.constructor.name === 'PutObjectCommand' && (command.input as Record<string, unknown>).Key === `processing/uploads/${upload.id}.json` && !(command.input as Record<string, unknown>).IfNoneMatch);
    expect(updates.length).toBeGreaterThan(0);
    expect(updates.every((command) => typeof (command.input as Record<string, unknown>).IfMatch === 'string')).toBe(true);
  });
  it.each(['copy', 'artifact-write'])('retains a retryable storage signal after a temporary %s failure and can inspect the same upload again', async (phase) => {
    const { preflight, media, send } = fixture();
    const bytes = await png();
    const { upload } = await preflight.createUpload('owner-1', { kind: 'image', contentType: 'image/png', byteSize: bytes.byteLength });
    await media.putBytes(upload.stagingKey, bytes, 'image/png');
    const original = send.getMockImplementation()!; let failed = false;
    send.mockImplementation(async (command) => {
      const input = command.input as { Key?: string };
      const target = phase === 'copy' ? command.constructor.name === 'CopyObjectCommand' : command.constructor.name === 'PutObjectCommand' && input.Key?.startsWith('processing/artifacts/');
      if (target && !failed) { failed = true; throw new Error('temporary storage write failure'); }
      return original(command);
    });
    await expect(preflight.inspect('owner-1', upload.id)).rejects.toMatchObject({ code: 'storage_unavailable', status: 503 });
    await expect(preflight.inspect('owner-1', upload.id)).resolves.toMatchObject({ sealed: true, metadata: { width: 4, height: 2 } });
    expect(await preflight.getUpload('owner-1', upload.id)).toMatchObject({ status: 'ready' });
  });
});
