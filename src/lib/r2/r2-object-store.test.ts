import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { R2ObjectStore } from './r2-object-store';

function createStore() {
  return new R2ObjectStore({
    endpoint: 'https://example-account.r2.cloudflarestorage.com',
    accessKeyId: 'test-access-key',
    secretAccessKey: 'test-secret-key',
    bucket: 'watermark',
  });
}

afterEach(() => vi.restoreAllMocks());

describe('R2ObjectStore', () => {
  it('generates path-style presigned upload and read URLs for R2', async () => {
    const store = createStore();
    const upload = new URL(await store.createUploadUrl('uploads/test.png', 'image/png'));
    const result = new URL(await store.createResultUrl('results/test.png'));
    const download = new URL(await store.createDownloadUrl('results/test.png'));

    expect(upload.hostname).toBe('example-account.r2.cloudflarestorage.com');
    expect(upload.pathname).toBe('/watermark/uploads/test.png');
    expect(result.pathname).toBe('/watermark/results/test.png');
    expect(download.searchParams.get('response-content-disposition')).toContain('attachment');
  });

  it('reads authoritative object metadata and treats only 404 as missing', async () => {
    const send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValueOnce({ ContentLength: 68, ContentType: 'image/png' } as never);
    const store = createStore();
    await expect(store.head('uploads/test.png')).resolves.toEqual({ contentLength: 68, contentType: 'image/png' });
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(HeadObjectCommand);

    send.mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } });
    await expect(store.head('uploads/missing.png')).resolves.toBeNull();

    send.mockRejectedValueOnce(new Error('R2 unavailable'));
    await expect(store.head('uploads/error.png')).rejects.toThrow('R2 unavailable');
  });

  it('deletes an object without exposing its key', async () => {
    const send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    const store = createStore();
    await store.delete('uploads/users/private/test.png');
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(DeleteObjectCommand);
    expect((send.mock.calls[0]?.[0] as DeleteObjectCommand).input).toEqual({
      Bucket: 'watermark', Key: 'uploads/users/private/test.png',
    });
  });

  it('copies objects and writes JSON under the requested keys', async () => {
    const send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    const store = createStore();

    await store.copyObject('uploads/source.png', 'results/job.png');
    const copy = send.mock.calls[0]?.[0];
    expect(copy).toBeInstanceOf(CopyObjectCommand);
    expect((copy as CopyObjectCommand).input).toMatchObject({
      Bucket: 'watermark', Key: 'results/job.png', CopySource: 'watermark/uploads/source.png',
    });

    await store.putJson('jobs/job.json', { status: 'completed' });
    const put = send.mock.calls[1]?.[0];
    expect(put).toBeInstanceOf(PutObjectCommand);
    expect((put as PutObjectCommand).input).toMatchObject({
      Bucket: 'watermark', Key: 'jobs/job.json', ContentType: 'application/json',
    });
  });

  it('reads JSON and handles missing objects without hiding other failures', async () => {
    const send = vi.spyOn(S3Client.prototype, 'send');
    send.mockResolvedValueOnce({ Body: { transformToString: vi.fn().mockResolvedValue('{"status":"completed"}') } } as never);
    const store = createStore();
    await expect(store.getJson('jobs/job.json')).resolves.toEqual({ status: 'completed' });
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(GetObjectCommand);

    send.mockResolvedValueOnce({} as never);
    await expect(store.getJson('jobs/empty.json')).resolves.toBeNull();

    send.mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } });
    await expect(store.getJson('jobs/missing.json')).resolves.toBeNull();

    send.mockRejectedValueOnce(new Error('R2 unavailable'));
    await expect(store.getJson('jobs/error.json')).rejects.toThrow('R2 unavailable');
  });

  it('reads and writes binary provider objects without exposing their contents', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const send = vi.spyOn(S3Client.prototype, 'send')
      .mockResolvedValueOnce({ Body: { transformToByteArray: vi.fn().mockResolvedValue(bytes) } } as never)
      .mockResolvedValueOnce({} as never);
    const store = createStore();

    await expect(store.getBytes('uploads/source.png')).resolves.toEqual(bytes);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(GetObjectCommand);

    await store.putBytes('results/job.jpg', bytes, 'image/jpeg');
    const put = send.mock.calls[1]?.[0];
    expect(put).toBeInstanceOf(PutObjectCommand);
    expect((put as PutObjectCommand).input).toMatchObject({
      Bucket: 'watermark', Key: 'results/job.jpg', Body: bytes, ContentType: 'image/jpeg',
    });
  });
});
