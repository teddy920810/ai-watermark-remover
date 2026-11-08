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
  it.each([['freeUses', 1], ['processingCredits', 3], ['purchasedImageCredits', 10], ['credits', 300]] as const)('keeps the original %s quote and charge through UNKNOWN recovery and refund', async (unit, amount) => {
    const s = setup(), savedQuote = { ...quote, amount, unit, priceVersion: 'original-price' };
    for (const [status, chargeStatus] of [['UNKNOWN', 'reserved'], ['READY', 'settled'], ['REFUNDED', 'refunded']] as const) {
      const savedJob = { ...job, quote: savedQuote, status, chargeStatus }, stored = JSON.stringify(savedJob);
      const view = await s.projection.job('user-1', savedJob);
      expect(view).toMatchObject({ quoteId: savedQuote.id, status, charge: { status: chargeStatus, amount, unit } });
      for (const alias of ['amount', 'unit', 'chargeStatus', 'quote']) expect(view).not.toHaveProperty(alias);
      expect(JSON.stringify(savedJob)).toBe(stored);
    }
  });
  it.each([
    ['image-watermark', 'image/jpeg', 'cleaned-image.jpg'],
    ['image-watermark-pro', 'image/jpeg', 'cleaned-image.jpg'],
    ['image-refine', 'image/jpeg', 'cleaned-image.jpg'],
    ['background-removal', 'image/png', 'background-removed-image.png'],
    ['object-removal', 'image/png', 'object-removed-image.png'],
    ['video-watermark', 'video/mp4', 'cleaned-video.mp4'],
  ] as const)('keeps the %s filename when issuing a fresh download', async (operation, contentType, filename) => {
    const s = setup(); const result = { ...artifact, key: mediaKey('result', 'user-1', 'a-1', contentType), metadata: { ...artifact.metadata, kind: contentType === 'video/mp4' ? 'video' as const : 'image' as const, contentType } };
    s.media.get.mockResolvedValue(result); s.media.head.mockResolvedValue({ byteSize: 1000, contentType, metadata: { 'owner-id': 'user-1', 'artifact-id': 'a-1' } });
    expect(await s.projection.download('user-1', { ...job, operation })).toMatchObject({ filename });
    expect(s.media.createDownloadUrl).toHaveBeenCalledWith(result.key, filename, 300);
  });
  it('returns a single representation of metadata, quote identity and charge while keeping private records unchanged', async () => {
    const s = setup();
    const stored = JSON.stringify({ artifact, quote, job });
    const publicArtifact = await s.projection.artifact('user-1', artifact);
    expect(Object.keys(publicArtifact).sort()).toEqual(['id', 'role', 'metadata', 'format', 'expiresAt', 'expired', 'previewUrl', 'canRefine'].sort());
    expect(publicArtifact.metadata).toEqual({ kind: 'image', contentType: 'image/jpeg', byteSize: 1000, width: 100, height: 80 });
    const publicQuote = await s.projection.quote('user-1', { ...quote, maskArtifactId: 'mask-1', parentJobId: 'parent-1' });
    expect(Object.keys(publicQuote).sort()).toEqual(['id', 'operation', 'inputArtifactId', 'maskArtifactId', 'parentJobId', 'amount', 'unit', 'priceVersion', 'createdAt', 'expiresAt', 'isDemo', 'expectedOutput'].sort());
    expect(publicQuote.expectedOutput).toEqual({ contentType: 'image/jpeg', format: 'JPG', width: 100, height: 80, transparent: false, background: 'white' });
    const publicJob = await s.projection.job('user-1', { ...job, parentJobId: 'parent-1', progress: 1 });
    expect(Object.keys(publicJob).sort()).toEqual(['id', 'operation', 'status', 'quoteId', 'charge', 'createdAt', 'updatedAt', 'expiresAt', 'parentJobId', 'progress', 'input', 'result', 'isDemo'].sort());
    expect(publicJob).toMatchObject({ quoteId: 'q-1', charge: { status: 'settled', amount: 1, unit: 'freeUses' } });
    const download = await s.projection.download('user-1', job);
    expect(Object.keys(download).sort()).toEqual(['url', 'filename', 'expiresAt', 'artifactId'].sort());
    expect(download.url).toBe('https://r2.test/fresh-download');
    expect(JSON.stringify({ artifact, quote, job })).toBe(stored);
    const privateNames = ['ownerId', 'key', 'sha256', 'providerSessionId', 'fingerprint', 'attempt', 'lease', 'dispatch', 'refundIntent', 'checkpoint', 'requestHash', 'ledger'];
    const projected = JSON.stringify({ publicArtifact, publicQuote, publicJob, download });
    for (const name of privateNames) expect(projected).not.toContain(`"${name}":`);
  });
  it('explains an unstarted dispatch timeout and the refunded allowance without suggesting an automatic replay', async () => {
    const s = setup(); const projected = await s.projection.job('user-1', { ...job, status: 'REFUNDED', chargeStatus: 'refunded', resultArtifactId: undefined, error: 'dispatch_timeout' });
    expect(projected).toMatchObject({ status: 'REFUNDED', charge: { status: 'refunded', amount: 1, unit: 'freeUses' }, errorCode: 'dispatch_timeout', error: 'The task did not start before the deadline. The reserved allowance was returned. Review the cost to try again.' });
    expect(projected.result).toBeUndefined();
  });
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
