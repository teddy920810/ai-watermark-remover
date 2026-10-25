import { describe, expect, it, vi } from 'vitest';
import { ProcessingService } from './processing-service';
import { MemoryArtifacts, MemoryFinance, MemoryJobs, MemoryQuotes, NOW, source } from './test-fixtures';
import type { OperationCapability } from './contracts';

export function setup() {
  const jobs = new MemoryJobs(); const artifacts = new MemoryArtifacts(); const quotes = new MemoryQuotes(); const finance = new MemoryFinance();
  artifacts.data.set('input-1', source());
  let id = 0; let now = NOW;
  const capabilities: OperationCapability[] = [
    { operation: 'image-watermark', enabled: true, acceptedTypes: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: 10_000_000 },
    { operation: 'image-watermark-pro', enabled: true, acceptedTypes: ['image/jpeg'], maxBytes: 10_000_000 },
    { operation: 'image-refine', enabled: true, acceptedTypes: ['image/jpeg'], maxBytes: 10_000_000 },
    { operation: 'video-watermark', enabled: true, acceptedTypes: ['video/mp4'], maxBytes: 100_000_000, maxDurationSeconds: 540, requiredFps: 24 },
  ];
  const inspector = { inspect: vi.fn(async (ownerId: string, id: string) => { const a = artifacts.data.get(id); if (!a || a.ownerId !== ownerId) throw new Error('Not found'); return a; }) };
  const service = new ProcessingService({ jobs, artifacts, quotes, finance, inspector, capabilities, prices: { version: 'test-1', amount: (op, metadata) => op === 'video-watermark' ? Math.ceil(metadata.durationSeconds! * 2) : op === 'image-watermark-pro' ? 3 : 1 }, now: () => new Date(now), id: () => `id-${++id}` });
  return { jobs, artifacts, quotes, finance, inspector, capabilities, service, setNow: (value: string) => { now = value; } };
}

describe('ProcessingService', () => {
  it('preflights without creating a financial reservation', async () => {
    const s = setup(); await s.service.preflight('user-1', 'input-1');
    expect(s.finance.admissions.size).toBe(0); expect(s.inspector.inspect).toHaveBeenCalled();
  });
  it('quotes sealed measured input and submits one admission despite repeat clicks', async () => {
    const s = setup(); const q = await s.service.quote({ ownerId: 'user-1', operation: 'image-watermark', inputArtifactId: 'input-1' });
    expect(q).toMatchObject({ amount: 1, unit: 'processingCredits', priceVersion: 'test-1' });
    const a = await s.service.submit({ ownerId: 'user-1', quoteId: q.id, idempotencyKey: 'click-1' });
    const b = await s.service.submit({ ownerId: 'user-1', quoteId: q.id, idempotencyKey: 'click-1' });
    expect(b.id).toBe(a.id); expect(s.finance.admissions.size).toBe(1); expect(await s.finance.getBalance('user-1')).toBe(99); expect(a.status).toBe('QUEUED');
  });
  it.each(['processingCredits', 'freeUses'] as const)('recovers an accepted %s submission before quote expiry, deletion or balance revalidation', async (unit) => {
    const s = setup(); s.finance.balances.set('user-1', unit === 'processingCredits' ? 1 : 0); s.finance.freeBalances.set('user-1', unit === 'freeUses' ? 1 : 0);
    const quote = await s.service.quote({ ownerId: 'user-1', operation: 'image-watermark', inputArtifactId: 'input-1' });
    const request = { ownerId: 'user-1', quoteId: quote.id, idempotencyKey: 'lost-response' };
    const accepted = await s.service.submit(request);
    s.setNow('2026-10-24T01:00:00.000Z'); s.capabilities[0].enabled = false; s.artifacts.data.clear();
    expect((await s.service.submit(request)).id).toBe(accepted.id);
    // Retention of the separate short-lived quote object must not control
    // recovery of an already-paid task: the job carries its sealed quote.
    s.quotes.data.clear(); const reservations = vi.spyOn(s.finance, 'reserveAndEnqueue'); const quoteReads = vi.spyOn(s.quotes, 'get');
    expect((await s.service.submit(request)).id).toBe(accepted.id);
    expect(reservations).not.toHaveBeenCalled(); expect(quoteReads).not.toHaveBeenCalled(); expect(s.finance.admissions.size).toBe(1);
    expect(await s.finance.getBalance('user-1', unit)).toBe(0);
  });
  it('rejects a reused operation key for another quote even when that quote no longer exists', async () => {
    const s = setup(); const quote = await s.service.quote({ ownerId: 'user-1', operation: 'image-watermark', inputArtifactId: 'input-1' });
    await s.service.submit({ ownerId: 'user-1', quoteId: quote.id, idempotencyKey: 'taken-key' });
    await expect(s.service.submit({ ownerId: 'user-1', quoteId: 'unrelated-deleted-quote', idempotencyKey: 'taken-key' })).rejects.toMatchObject({ code: 'idempotency_conflict', status: 409 });
    expect(s.finance.admissions.size).toBe(1);
  });
  it('binds a quote to actual metadata and rejects changed input before reserving', async () => {
    const s = setup(); const q = await s.service.quote({ ownerId: 'user-1', operation: 'image-watermark', inputArtifactId: 'input-1' });
    s.artifacts.data.set('input-1', source({ sha256: 'changed' }));
    await expect(s.service.submit({ ownerId: 'user-1', quoteId: q.id, idempotencyKey: 'k' })).rejects.toMatchObject({ code: 'quote_changed' });
    expect(s.finance.admissions.size).toBe(0);
  });
  it('rejects another owner, unsealed input, expired quotes and conflicting operation keys', async () => {
    const s = setup();
    await expect(s.service.quote({ ownerId: 'intruder', operation: 'image-watermark', inputArtifactId: 'input-1' })).rejects.toMatchObject({ status: 404 });
    s.artifacts.data.set('input-1', source({ sealed: false }));
    await expect(s.service.quote({ ownerId: 'user-1', operation: 'image-watermark', inputArtifactId: 'input-1' })).rejects.toMatchObject({ code: 'input_not_sealed' });
    s.artifacts.data.set('input-1', source());
    const q = await s.service.quote({ ownerId: 'user-1', operation: 'image-watermark', inputArtifactId: 'input-1' });
    const q2 = await s.service.quote({ ownerId: 'user-1', operation: 'image-watermark-pro', inputArtifactId: 'input-1' });
    await s.service.submit({ ownerId: 'user-1', quoteId: q.id, idempotencyKey: 'k' });
    await expect(s.service.submit({ ownerId: 'user-1', quoteId: q2.id, idempotencyKey: 'k' })).rejects.toMatchObject({ code: 'idempotency_conflict' });
    s.setNow('2026-10-24T01:00:00.000Z');
    await expect(s.service.submit({ ownerId: 'user-1', quoteId: q.id, idempotencyKey: 'new' })).rejects.toMatchObject({ code: 'quote_expired' });
  });
  it('rejects disabled operation and invalid video duration/fps before charging', async () => {
    const s = setup(); s.capabilities[0].enabled = false;
    await expect(s.service.quote({ ownerId: 'user-1', operation: 'image-watermark', inputArtifactId: 'input-1' })).rejects.toMatchObject({ code: 'operation_unavailable' });
    s.artifacts.data.set('video', source({ id: 'video', metadata: { kind: 'video', contentType: 'video/mp4', byteSize: 1000, width: 1280, height: 720, durationSeconds: 10, fps: 30 } }));
    await expect(s.service.quote({ ownerId: 'user-1', operation: 'video-watermark', inputArtifactId: 'video' })).rejects.toMatchObject({ code: 'unsupported_fps' });
    s.artifacts.data.get('video')!.metadata.fps = 24;
    expect((await s.service.quote({ ownerId: 'user-1', operation: 'video-watermark', inputArtifactId: 'video' })).amount).toBe(20);
  });
  it('requires a parent successful normal version, session and matching mask for refinement', async () => {
    const s = setup();
    await expect(s.service.quote({ ownerId: 'user-1', operation: 'image-refine', inputArtifactId: 'input-1' })).rejects.toMatchObject({ code: 'refinement_requires_parent' });
    const q = await s.service.quote({ ownerId: 'user-1', operation: 'image-watermark', inputArtifactId: 'input-1' });
    const job = await s.service.submit({ ownerId: 'user-1', quoteId: q.id, idempotencyKey: 'k' });
    const result = source({ id: 'result', role: 'result', providerSessionId: 'session-1' }); s.artifacts.data.set('result', result);
    s.artifacts.data.set('mask', source({ id: 'mask', role: 'mask', metadata: { ...result.metadata, contentType: 'image/png' } }));
    const record = await s.jobs.get(job.id); await s.jobs.compareAndSwap(job.id, record!.version, { ...job, status: 'READY', resultArtifactId: 'result' });
    expect(await s.service.quote({ ownerId: 'user-1', operation: 'image-refine', inputArtifactId: 'result', maskArtifactId: 'mask', parentJobId: job.id })).toMatchObject({ parentJobId: job.id, maskArtifactId: 'mask' });
    s.artifacts.data.get('mask')!.metadata.width = 1;
    await expect(s.service.quote({ ownerId: 'user-1', operation: 'image-refine', inputArtifactId: 'result', maskArtifactId: 'mask', parentJobId: job.id })).rejects.toMatchObject({ code: 'invalid_mask' });
  });
  it('prevents cross-owner task reads and lists only current-owner jobs', async () => {
    const s = setup(); const q = await s.service.quote({ ownerId: 'user-1', operation: 'image-watermark', inputArtifactId: 'input-1' });
    const job = await s.service.submit({ ownerId: 'user-1', quoteId: q.id, idempotencyKey: 'k' });
    await expect(s.service.get('other', job.id)).rejects.toMatchObject({ status: 404 });
    expect(await s.service.list('other')).toEqual([]);
  });
  it('preserves normal-image free uses while PRO uses separately allocated credits', async () => {
    const s = setup(); s.finance.freeBalances.set('user-1', 2);
    const normal = await s.service.quote({ ownerId: 'user-1', operation: 'image-watermark', inputArtifactId: 'input-1' });
    const pro = await s.service.quote({ ownerId: 'user-1', operation: 'image-watermark-pro', inputArtifactId: 'input-1' });
    expect(normal.unit).toBe('freeUses'); expect(pro.unit).toBe('processingCredits');
    await s.service.submit({ ownerId: 'user-1', quoteId: normal.id, idempotencyKey: 'normal' });
    expect(await s.finance.getBalance('user-1', 'freeUses')).toBe(1);
    expect(await s.finance.getBalance('user-1')).toBe(100);
  });
  it('refuses refinement above 1920px instead of silently shrinking a paid version', async () => {
    const s = setup(); s.artifacts.data.set('input-1', source({ metadata: { ...source().metadata, width: 2000 } }));
    await expect(s.service.quote({ ownerId: 'user-1', operation: 'image-refine', inputArtifactId: 'input-1' })).rejects.toMatchObject({ code: 'refinement_resolution_limit' });
    expect(s.finance.admissions.size).toBe(0);
  });
  it('does not expose unadmitted prepared manifests as paid tasks after insufficient balance', async () => {
    const s = setup(); s.finance.balances.set('user-1', 0);
    const q = await s.service.quote({ ownerId: 'user-1', operation: 'image-watermark', inputArtifactId: 'input-1' });
    await expect(s.service.submit({ ownerId: 'user-1', quoteId: q.id, idempotencyKey: 'k' })).rejects.toMatchObject({ code: 'insufficient_balance' });
    expect(await s.service.list('user-1')).toEqual([]);
  });
  it('keeps an older admitted task visible after more than twenty abandoned preparations', async () => {
    const s = setup(); const q = await s.service.quote({ ownerId: 'user-1', operation: 'image-watermark', inputArtifactId: 'input-1' });
    const accepted = await s.service.submit({ ownerId: 'user-1', quoteId: q.id, idempotencyKey: 'accepted' });
    s.finance.balances.set('user-1', 0); s.setNow('2026-10-24T00:01:00.000Z');
    for (let index = 0; index < 25; index++) await expect(s.service.submit({ ownerId: 'user-1', quoteId: q.id, idempotencyKey: `abandoned-${index}` })).rejects.toMatchObject({ code: 'insufficient_balance' });
    expect(s.jobs.data.size).toBe(26); expect(s.finance.admissions.size).toBe(1);
    expect((await s.service.list('user-1')).map((job) => job.id)).toEqual([accepted.id]);
  });
  it('lists an admitted task once when concurrent idempotent retries leave newer prepared manifests', async () => {
    const s = setup(); const q = await s.service.quote({ ownerId: 'user-1', operation: 'image-watermark', inputArtifactId: 'input-1' });
    const request = { ownerId: 'user-1', quoteId: q.id, idempotencyKey: 'concurrent-key' };
    const accepted = await s.service.submit(request); s.setNow('2026-10-24T00:01:00.000Z');
    vi.spyOn(s.finance, 'findAdmission').mockResolvedValue(null);
    const reserve = s.finance.reserveAndEnqueue.bind(s.finance);
    vi.spyOn(s.finance, 'reserveAndEnqueue').mockImplementation(async (value) => {
      const existing = s.finance.admissions.get(accepted.id)!;
      return existing ? { admission: existing, created: false } : reserve(value);
    });
    for (let index = 0; index < 25; index++) expect((await s.service.submit(request)).id).toBe(accepted.id);
    expect(s.jobs.data.size).toBe(26); expect(s.finance.admissions.size).toBe(1); expect(await s.finance.getBalance('user-1')).toBe(99);
    expect((await s.service.list('user-1')).map((job) => job.id)).toEqual([accepted.id]);
  });
  it('fills the requested history limit across missing R2 manifests without scanning the owner index', async () => {
    const s = setup(); const admitted: string[] = [];
    for (let index = 0; index < 25; index++) {
      s.setNow(new Date(Date.parse(NOW) + index * 1000).toISOString());
      const q = await s.service.quote({ ownerId: 'user-1', operation: 'image-watermark', inputArtifactId: 'input-1' });
      admitted.push((await s.service.submit({ ownerId: 'user-1', quoteId: q.id, idempotencyKey: `history-${index}` })).id);
    }
    for (const id of admitted.slice(3)) s.jobs.data.delete(id);
    const ownerIndex = vi.spyOn(s.jobs, 'listForOwner'); const pages = vi.spyOn(s.finance, 'listAdmissionsForOwner');
    expect((await s.service.list('user-1', 3)).map((job) => job.id)).toEqual(admitted.slice(0, 3).reverse());
    expect(ownerIndex).not.toHaveBeenCalled(); expect(pages.mock.calls.length).toBeGreaterThan(1);
    expect(pages.mock.calls.every(([ownerId, limit]) => ownerId === 'user-1' && limit! <= 100)).toBe(true);
  });
  it('orders same-time admissions deterministically, limits valid tasks and checks manifest ownership', async () => {
    const s = setup(); const admitted: string[] = [];
    for (let index = 0; index < 5; index++) {
      const q = await s.service.quote({ ownerId: 'user-1', operation: 'image-watermark', inputArtifactId: 'input-1' });
      admitted.push((await s.service.submit({ ownerId: 'user-1', quoteId: q.id, idempotencyKey: `order-${index}` })).id);
    }
    const ordered = [...admitted].sort().reverse(); const corrupted = s.jobs.data.get(ordered[0])!; corrupted.job.ownerId = 'other';
    const foreign = s.finance.admissions.get(ordered[1])!; foreign.ownerId = 'other';
    const listed = await s.service.list('user-1', 2);
    expect(listed.map((job) => job.id)).toEqual(ordered.slice(2, 4)); expect(listed.every((job) => job.ownerId === 'user-1')).toBe(true);
    expect(await s.service.list('unknown')).toEqual([]);
  });
  it('rejects an unnormalized source larger than the automatic API limit before quoting', async () => {
    const s = setup(); s.artifacts.data.set('input-1', source({ metadata: { ...source().metadata, width: 6001 } }));
    await expect(s.service.quote({ ownerId: 'user-1', operation: 'image-watermark-pro', inputArtifactId: 'input-1' })).rejects.toMatchObject({ code: 'image_resolution_limit' });
  });
});
