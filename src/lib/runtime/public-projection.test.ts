import { describe, expect, it, vi } from 'vitest';
import { PublicProcessingProjection } from './public-projection';
import { mediaKey } from './private-media-store';
import type { ProcessingArtifact, ProcessingJob, ProcessingQuote } from '../processing/contracts';

const now = '2026-10-24T00:00:00.000Z';
const artifact: ProcessingArtifact = { id: 'a-1', ownerId: 'user-1', key: mediaKey('result', 'user-1', 'a-1', 'image/jpeg'), role: 'result', sealed: true, sha256: 'private-hash', providerSessionId: 'private-session', metadata: { kind: 'image', contentType: 'image/jpeg', width: 100, height: 80, byteSize: 1000 }, createdAt: now, expiresAt: '2026-10-25T00:00:00.000Z' };
const quote: ProcessingQuote = { id: 'q-1', ownerId: 'user-1', operation: 'image-watermark', inputArtifactId: 'a-1', amount: 1, unit: 'freeUses', priceVersion: '1', fingerprint: 'private-fingerprint', createdAt: now, expiresAt: '2026-10-24T00:10:00.000Z' };
const job: ProcessingJob = { id: 'j-1', ownerId: 'user-1', operation: 'image-watermark', status: 'READY', quote, inputArtifactId: 'a-1', resultArtifactId: 'a-1', chargeStatus: 'settled', attempt: { id: 'private-attempt', startedAt: now, checkpoint: { providerJobId: 'private-vendor-task', sessionId: 'private-session' } }, lease: { owner: 'private-worker', epoch: 1, expiresAt: now }, createdAt: now, updatedAt: now, expiresAt: artifact.expiresAt };
function setup() {
  let clock = now;
  const media = { get: vi.fn(async () => structuredClone(artifact)), head: vi.fn(async () => ({ byteSize: 1000, contentType: 'image/jpeg', metadata: { 'owner-id': 'user-1', 'artifact-id': 'a-1' } })), createDownloadUrl: vi.fn(async () => 'https://r2.test/fresh-download') };
  const signPreview = vi.fn(async () => 'https://r2.test/preview');
  const projection = new PublicProcessingProjection({ media, signPreview, now: () => new Date(clock), refinementEnabled: true });
  return { projection, media, signPreview, setNow: (value: string) => { clock = value; } };
}

describe('public processing projection', () => {
  it('whitelists job/artifact/quote fields instead of leaking keys, hashes, sessions or execution state', async () => {
    const s = setup(); const projected = await s.projection.job('user-1', job);
    expect(projected).toMatchObject({ id: 'j-1', status: 'READY', charge: { status: 'settled', amount: 1, unit: 'freeUses' }, result: { role: 'result', previewUrl: 'https://r2.test/preview', canRefine: true } });
    const json = JSON.stringify(projected);
    for (const secret of [artifact.key, 'ownerId', 'private-hash', 'private-session', 'private-attempt', 'private-fingerprint', 'private-vendor-task', 'private-worker']) expect(json).not.toContain(secret);
    const q = await s.projection.quote('user-1', quote);
    expect(q).toMatchObject({ expectedOutput: { contentType: 'image/jpeg', format: 'JPG', width: 100, height: 80 } });
    expect(JSON.stringify(q)).not.toContain('fingerprint');
  });
  it('requires ownership, READY, actual stored result and unexpired retention before signing a fresh download', async () => {
    const s = setup();
    await expect(s.projection.download('other', job)).rejects.toMatchObject({ status: 404 });
    await expect(s.projection.download('user-1', { ...job, status: 'SAVING' })).rejects.toMatchObject({ status: 409 });
    expect(await s.projection.download('user-1', job)).toMatchObject({ url: 'https://r2.test/fresh-download' });
    await s.projection.download('user-1', job); expect(s.media.createDownloadUrl).toHaveBeenCalledTimes(2);
    s.media.head.mockResolvedValueOnce(null as never); await expect(s.projection.download('user-1', job)).rejects.toMatchObject({ status: 410 });
    s.setNow('2026-10-25T01:00:00.000Z'); await expect(s.projection.download('user-1', job)).rejects.toMatchObject({ status: 410 });
  });
  it('does not offer refinement for PRO, oversized images or an unavailable operation', async () => {
    const s = setup(); expect((await s.projection.job('user-1', { ...job, operation: 'image-watermark-pro' })).result?.canRefine).toBe(false);
    s.media.get.mockResolvedValue({ ...artifact, metadata: { ...artifact.metadata, width: 1921 } });
    expect((await s.projection.job('user-1', job)).result?.canRefine).toBe(false);
  });
  it('keeps expired artifact metadata visible without signing an expired preview', async () => {
    const s = setup(); s.setNow('2026-10-25T01:00:00.000Z');
    expect((await s.projection.job('user-1', job)).result).toMatchObject({ expired: true }); expect(s.signPreview).not.toHaveBeenCalled();
  });
  it('honors an earlier task deadline even while immutable result metadata still exists', async () => {
    const s = setup(); const expired = await s.projection.job('user-1', { ...job, expiresAt: '2026-10-23T23:59:59.000Z' });
    expect(expired.status).toBe('EXPIRED'); expect(expired.result).toMatchObject({ expired: true, canRefine: false }); expect(expired.result?.previewUrl).toBeUndefined();
  });
});
