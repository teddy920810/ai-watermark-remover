import { describe, expect, it } from 'vitest';
import { ProcessingService } from './processing-service';
import { MemoryArtifacts, MemoryFinance, MemoryJobs, MemoryQuotes, NOW, source } from './test-fixtures';
import { durableCapabilities, operationCatalog } from '../contracts/operation-catalog';
import { PublicProcessingProjection } from '../runtime/public-projection';
import { mediaKey } from '../runtime/private-media-store';

describe.each(['background-removal', 'object-removal'] as const)('%s durable contract', operation => {
const cost = operation === 'object-removal' ? 4 : 10;
function setup(enabled = true) {
  const artifacts = new MemoryArtifacts(); artifacts.data.set('input-1', source({ key: mediaKey('source', 'user-1', 'input-1', 'image/jpeg') }));
  artifacts.data.set('mask-1', source({ id: 'mask-1', role: 'mask', parentArtifactId: 'input-1', key: mediaKey('mask', 'user-1', 'mask-1', 'image/png'), metadata: { kind: 'image', contentType: 'image/png', byteSize: 100, width: 100, height: 100 } }));
  const finance = new MemoryFinance(); const jobs = new MemoryJobs(); const quotes = new MemoryQuotes(); let next = 0;
  const options = { jobs, artifacts, finance, quotes, inspector: { inspect: async () => source() }, capabilities: durableCapabilities(true),
    purchasedImageCreditsEnabled: enabled, imageCreditCosts: { 'background-removal': 10, 'object-removal': 4 }, imageCreditPriceVersion: 'image-1',
    prices: { version: 'processing-1', amount: () => 1 }, now: () => new Date(NOW), id: () => `id-${++next}` };
  return { artifacts, finance, jobs, quotes, options, service: new ProcessingService(options) };
}
const request = { ownerId: 'user-1', operation, inputArtifactId: 'input-1', ...(operation === 'object-removal' ? { maskArtifactId: 'mask-1' } : {}) };

describe('durable background removal contract', () => {
  it('has a Worker capability while retaining its old-protocol identity and PNG semantics', () => {
    expect(operationCatalog[operation]).toMatchObject({ protocol: 'v1', executor: 'worker', imageCreditOperation: operation, output: operation === 'object-removal' ? 'png' : 'rgba-png', units: ['freeUses', 'purchasedImageCredits', 'credits'] });
    expect(durableCapabilities(true).some(capability => capability.operation === operation)).toBe(true);
  });
  it('uses one free use first, then its configured image cost, never administrator credits', async () => {
    const s = setup(); s.finance.freeBalances.set('user-1', 1); s.finance.imageBalances.set('user-1', 20);
    const free = await s.service.quote(request); expect(free).toMatchObject({ amount: 1, unit: 'freeUses' });
    await s.service.submit({ ownerId: 'user-1', quoteId: free.id, idempotencyKey: 'free' });
    const paid = await s.service.quote(request); expect(paid).toMatchObject({ amount: cost, unit: 'purchasedImageCredits' });
    const job = await s.service.submit({ ownerId: 'user-1', quoteId: paid.id, idempotencyKey: 'paid' });
    expect((await s.service.submit({ ownerId: 'user-1', quoteId: paid.id, idempotencyKey: 'paid' })).id).toBe(job.id);
    expect(await s.finance.getBalance('user-1')).toBe(100);
    expect(await s.finance.getBalance('user-1', 'purchasedImageCredits')).toBe(20 - cost);
    await s.finance.refund(job.id, 'user-1'); await s.finance.refund(job.id, 'user-1');
    expect(await s.finance.getBalance('user-1', 'purchasedImageCredits')).toBe(20);
  });
  it('refuses insufficient image allowance even when administrator credits exist, and stays free-only when purchases are disabled', async () => {
    for (const enabled of [true, false]) {
      const s = setup(enabled); const quote = await s.service.quote(request);
      expect(quote.unit).toBe(enabled ? 'purchasedImageCredits' : 'freeUses');
      await expect(s.service.submit({ ownerId: 'user-1', quoteId: quote.id, idempotencyKey: 'cannot-spend-admin' })).rejects.toMatchObject({ code: 'insufficient_balance' });
      expect(await s.finance.getBalance('user-1')).toBe(100);
    }
  });
  it('seals image price versions and preserves an accepted quote through later price changes', async () => {
    const s = setup(); s.finance.imageBalances.set('user-1', 30);
    const quote = await s.service.quote(request); const stale = await s.service.quote(request);
    const accepted = await s.service.submit({ ownerId: 'user-1', quoteId: quote.id, idempotencyKey: 'accepted' });
    s.options.imageCreditPriceVersion = 'image-2'; s.options.imageCreditCosts[operation] = 15;
    await expect(s.service.submit({ ownerId: 'user-1', quoteId: stale.id, idempotencyKey: 'stale' })).rejects.toMatchObject({ code: 'quote_changed' });
    expect((await s.service.submit({ ownerId: 'user-1', quoteId: quote.id, idempotencyKey: 'accepted' })).id).toBe(accepted.id);
    expect(await s.finance.getBalance('user-1', 'purchasedImageCredits')).toBe(30 - cost);
  });
  it('projects transparent PNG and never advertises refinement for background results', async () => {
    const s = setup(); s.finance.freeBalances.set('user-1', 1); const quote = await s.service.quote(request);
    const projection = new PublicProcessingProjection({ media: { get: async id => s.artifacts.get(id), head: async () => null, createDownloadUrl: async () => '' }, signPreview: async () => 'https://private.test/preview', now: () => new Date(NOW), refinementEnabled: true });
    expect((await projection.quote('user-1', quote)).expectedOutput).toMatchObject({ contentType: 'image/png', format: 'PNG', width: 100, height: 100, ...(operation === 'background-removal' ? { transparent: true } : {}) });
    if (operation === 'object-removal') expect((await projection.quote('user-1', quote)).expectedOutput).not.toHaveProperty('background');
    const result = source({ id: 'result', key: 'processing/results/user/result.png', role: 'result', providerSessionId: 'unexpected-old-session' });
    result.metadata.contentType = 'image/png'; result.key = mediaKey('result', result.ownerId, result.id, result.metadata.contentType);
    s.artifacts.data.set('result', result);
    const job = await s.service.submit({ ownerId: 'user-1', quoteId: quote.id, idempotencyKey: 'projection' });
    expect((await projection.job('user-1', { ...job, status: 'READY', resultArtifactId: result.id })).result?.canRefine).toBe(false);
  });
});

  it('requires an owned selection tied to the exact source for object removal', async () => {
    if (operation !== 'object-removal') return;
    const s = setup();
    await expect(s.service.quote({ ...request, maskArtifactId: undefined })).rejects.toMatchObject({ code: 'invalid_mask' });
    const mask = s.artifacts.data.get('mask-1')!;
    for (const change of [{ parentArtifactId: 'other-input' }, { ownerId: 'another-owner' }, { metadata: { ...mask.metadata, width: 50 } }, { sealed: false }]) {
      s.artifacts.data.set('mask-1', { ...mask, ...change });
      await expect(s.service.quote(request)).rejects.toThrow();
    }
    s.artifacts.data.set('mask-1', mask);
    const first = await s.service.quote(request);
    s.artifacts.data.set('mask-1', { ...mask, sha256: 'redrawn' });
    s.finance.freeBalances.set('user-1', 1);
    await expect(s.service.submit({ ownerId: 'user-1', quoteId: first.id, idempotencyKey: 'old-mask' })).rejects.toMatchObject({ code: 'quote_changed' });
    expect(s.finance.admissions.size).toBe(0);
  });
});
