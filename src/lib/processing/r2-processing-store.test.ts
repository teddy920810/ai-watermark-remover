import { describe, expect, it, vi } from 'vitest';
import type { S3Client } from '@aws-sdk/client-s3';
import { R2ProcessingArtifactStore, R2ProcessingJobStore, R2ProcessingQuoteStore, S3ConditionalJsonStore } from './r2-processing-store';
import type { ConditionalJsonStore } from './r2-processing-store';
import { source, NOW } from './test-fixtures';
import type { ProcessingJob } from './contracts';

class MemoryJson implements ConditionalJsonStore {
  data = new Map<string, { value: unknown; version: string }>();
  async get<T>(key: string) { const v = this.data.get(key); return v ? { value: structuredClone(v.value) as T, version: v.version } : null; }
  async create(key: string, value: unknown) { if (this.data.has(key)) return false; this.data.set(key, { value: structuredClone(value), version: '1' }); return true; }
  async update(key: string, version: string, value: unknown) { const current = this.data.get(key); if (!current || current.version !== version) return false; this.data.set(key, { value: structuredClone(value), version: String(Number(version) + 1) }); return true; }
  async list(prefix: string, limit: number) { return [...this.data.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, limit); }
}
const job: ProcessingJob = { id: 'job-1', ownerId: 'user-1', operation: 'image-watermark', status: 'PREPARED', inputArtifactId: 'input-1', chargeStatus: 'reserved', createdAt: NOW, updatedAt: NOW, quote: { id: 'quote-1', ownerId: 'user-1', operation: 'image-watermark', inputArtifactId: 'input-1', amount: 1, unit: 'processingCredits', priceVersion: '1', fingerprint: 'h', createdAt: NOW, expiresAt: NOW } };

describe('R2 processing state', () => {
  it('allows only one create and refuses stale state updates', async () => {
    const store = new R2ProcessingJobStore(new MemoryJson());
    expect(await store.create(job)).toBe(true); expect(await store.create(job)).toBe(false);
    const current = await store.get(job.id);
    expect(await store.compareAndSwap(job.id, current!.version, { ...job, status: 'QUEUED' })).toBe(true);
    expect(await store.compareAndSwap(job.id, current!.version, { ...job, status: 'FAILED' })).toBe(false);
    expect((await store.get(job.id))!.job.status).toBe('QUEUED');
    expect(await store.listForOwner('intruder')).toEqual([]); expect(await store.listForOwner('user-1')).toHaveLength(1);
  });
  it('keeps late attempt responses immutable and outside authoritative state', async () => {
    const store = new R2ProcessingJobStore(new MemoryJson()); await store.create(job);
    const response = { jobId: job.id, attemptId: 'a-1', artifact: source({ role: 'result' }), receivedAt: NOW };
    await store.recordAttemptResult(response); await store.recordAttemptResult({ ...response, receivedAt: 'changed' });
    expect((await store.getAttemptResult(job.id, 'a-1'))!.receivedAt).toBe(NOW);
    expect((await store.get(job.id))!.job.status).toBe('PREPARED');
  });
  it('does not overwrite an immutable quote or artifact and delegates byte verification', async () => {
    const json = new MemoryJson(); const verify = vi.fn().mockResolvedValue(undefined);
    const artifacts = new R2ProcessingArtifactStore(json, verify); const quotes = new R2ProcessingQuoteStore(json);
    await artifacts.create(source()); await artifacts.create(source()); await artifacts.verifyStored(source());
    await expect(artifacts.create(source({ sha256: 'changed' }))).rejects.toMatchObject({ code: 'immutable_conflict' });
    await quotes.create(job.quote); expect(await quotes.get(job.quote.id)).toEqual(job.quote);
    expect(await artifacts.get('missing')).toBeNull(); expect(verify).toHaveBeenCalled();
  });
});

describe('S3 conditional JSON adapter', () => {
  it('sends atomic create/update conditions instead of a read then blind write', async () => {
    const send = vi.fn().mockResolvedValue({}); const store = new S3ConditionalJsonStore({ send } as unknown as S3Client, 'private-bucket');
    expect(await store.create('job', job)).toBe(true); expect(send.mock.calls[0][0].input.IfNoneMatch).toBe('*');
    expect(await store.update('job', '"etag"', job)).toBe(true); expect(send.mock.calls[1][0].input.IfMatch).toBe('"etag"');
    send.mockRejectedValue({ $metadata: { httpStatusCode: 412 } }); expect(await store.update('job', 'old', job)).toBe(false);
    send.mockRejectedValue(new Error('Storage unavailable')); await expect(store.create('job', job)).rejects.toThrow('Storage unavailable');
  });
  it('reads ETags, handles absence and follows list pagination', async () => {
    const send = vi.fn().mockResolvedValueOnce({ ETag: '"version"', Body: { transformToString: async () => '{"id":1}' } }).mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } })
      .mockResolvedValueOnce({ Contents: [{ Key: 'p/one' }], IsTruncated: true, NextContinuationToken: 'next' }).mockResolvedValueOnce({ Contents: [{ Key: 'p/two' }], IsTruncated: false });
    const store = new S3ConditionalJsonStore({ send } as unknown as S3Client, 'bucket');
    expect(await store.get('one')).toEqual({ value: { id: 1 }, version: '"version"' }); expect(await store.get('missing')).toBeNull();
    expect(await store.list('p/', 10)).toEqual(['p/one', 'p/two']);
  });
});
