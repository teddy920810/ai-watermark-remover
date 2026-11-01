import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import type { ProcessingArtifact, ProcessingJob, ProcessingProviderContext } from '../processing/contracts';
import { DefinitiveProviderError } from '../processing/contracts';
import { memoryMediaStore } from './test-fixtures';
import { mediaKey } from './private-media-store';
import { ReplicateImageProvider } from './replicate-image-provider';

const now = () => new Date('2026-10-24T00:00:00.000Z');
const objectVersion = 'cdac78a1bec5b23c07fd29692fb70baa513ea403a39e643c48ec5edadb15fe72';
describe.each(['background-removal', 'object-removal'] as const)('%s durable Replicate adapter', operation => {
const version = operation === 'object-removal' ? objectVersion : 'a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc';
async function fixture() {
  const memory = memoryMediaStore();
  const bytes = await sharp({ create: { width: 4, height: 2, channels: 4, background: '#55aaff00' } }).png().toBuffer();
  const input: ProcessingArtifact = { id: 'source-1', ownerId: 'owner-1', key: mediaKey('source', 'owner-1', 'source-1', 'image/png'), role: 'source', sealed: true, sha256: createHash('sha256').update(bytes).digest('hex'), metadata: await memory.media.inspectBytes(bytes, 'image'), createdAt: now().toISOString(), expiresAt: '2026-10-25T00:00:00.000Z' };
  await memory.media.putBytes(input.key, bytes, 'image/png', { 'owner-id': input.ownerId, 'artifact-id': input.id }); await memory.media.create(input);
  const job: ProcessingJob = { id: 'job-1', ownerId: input.ownerId, operation, inputArtifactId: input.id, status: 'SUBMITTING', chargeStatus: 'reserved', attempt: { id: 'attempt-1', startedAt: now().toISOString() }, createdAt: now().toISOString(), updatedAt: now().toISOString(), quote: { id: 'quote-1', ownerId: input.ownerId, operation, inputArtifactId: input.id, amount: 10, unit: 'purchasedImageCredits', priceVersion: 'image-1', fingerprint: 'sealed', createdAt: now().toISOString(), expiresAt: '2026-10-25T00:00:00.000Z' } };
  const maskBytes = await sharp({ create: { width: 4, height: 2, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const mask: ProcessingArtifact = { ...input, id: 'mask-1', role: 'mask', parentArtifactId: input.id, key: mediaKey('mask', input.ownerId, 'mask-1', 'image/png'), sha256: createHash('sha256').update(maskBytes).digest('hex'), metadata: await memory.media.inspectBytes(maskBytes, 'image') };
  await memory.media.putBytes(mask.key, maskBytes, 'image/png', { 'owner-id': mask.ownerId, 'artifact-id': mask.id }); await memory.media.create(mask);
  if (operation === 'object-removal') { job.maskArtifactId = mask.id; job.quote.maskArtifactId = mask.id; }
  const context: ProcessingProviderContext = { job, input, ...(operation === 'object-removal' ? { mask } : {}), heartbeat: vi.fn().mockResolvedValue(undefined), checkpoint: vi.fn(async value => { job.attempt!.checkpoint = { ...job.attempt!.checkpoint, ...value }; }) };
  return { ...memory, bytes, input, job, context };
}
function provider(s: Awaited<ReturnType<typeof fixture>>, request: typeof fetch) {
  return new ReplicateImageProvider({ media: s.media, operation, config: { apiToken: 'server-only-token', baseUrl: 'https://api.replicate.com', modelVersion: version, timeoutMs: 45_000, waitSeconds: 20 }, request, now, id: () => 'result-1' });
}

describe('durable Replicate background adapter', () => {
  it('preserves the vendor request and stores a verified transparent PNG receipt before settlement', async () => {
    // Primary contracts: https://replicate.com/851-labs/background-remover/api and https://replicate.com/docs/reference/http
    const s = await fixture();
    const request = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (String(url).endsWith('/v1/predictions')) {
        if (operation === 'background-removal') expect(url).toBe('https://api.replicate.com/v1/predictions');
        else { expect(url).toBeInstanceOf(URL); expect(String(url)).toBe('https://api.replicate.com/v1/predictions'); }
        expect(init?.method).toBe('POST');
        expect(init?.headers).toEqual({ Authorization: 'Bearer server-only-token', 'Content-Type': 'application/json', Prefer: 'wait=20', 'Cancel-After': '45s' });
        expect(JSON.parse(String(init?.body))).toEqual(operation === 'object-removal' ? { version: `allenhooo/lama:${version}`, input: { image: 'https://r2.example.test/signed', mask: 'https://r2.example.test/signed' } } : { version: `851-labs/background-remover:${version}`, input: { image: 'https://r2.example.test/signed', format: 'png', reverse: false, threshold: 0, background_type: 'rgba' } });
        return Response.json({ id: 'prediction-1', status: 'succeeded', output: 'https://replicate.delivery/output.png' });
      }
      expect(String(url)).toBe('https://replicate.delivery/output.png'); return new Response(s.bytes);
    });
    const outcome = await provider(s, request).submit(s.context);
    expect(outcome).toMatchObject({ status: 'completed', artifact: { ownerId: 'owner-1', role: 'result', parentArtifactId: s.input.id, metadata: { width: 4, height: 2, contentType: 'image/png' } } });
    if (outcome.status !== 'completed') throw new Error('Expected completion');
    expect(await s.media.getJson('processing/provider-attempts/job-1/attempt-1/predictions.json')).toMatchObject({ id: 'prediction-1', ownerId: 'owner-1', inputArtifactId: s.input.id });
    expect(await s.media.getJson('processing/provider-attempts/job-1/attempt-1/results.json')).toMatchObject({ id: outcome.artifact.id });
    await s.media.verifyStored(outcome.artifact);
    if (operation === 'object-removal') expect(Buffer.from(await s.media.getBytes(outcome.artifact.key))).toEqual(s.bytes);
    expect(await sharp(await s.media.getBytes(outcome.artifact.key)).metadata()).toMatchObject({ format: 'png', hasAlpha: true });
    expect((s.context.checkpoint as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]).toBeLessThan(request.mock.invocationCallOrder[0]);
    expect((s.context.checkpoint as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ provider: 'replicate', stage: 'submitting' });
    expect(JSON.stringify([...s.objects.values()].filter(value => value.contentType === 'application/json').map(value => Buffer.from(value.bytes).toString()))).not.toContain('server-only-token');
  });
  it('recovers the same asynchronous prediction from its private receipt without another POST', async () => {
    const s = await fixture();
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ id: 'prediction-1', status: 'processing' })).mockResolvedValueOnce(Response.json({ id: 'prediction-1', status: 'succeeded', output: 'https://replicate.delivery/output.png' })).mockResolvedValueOnce(new Response(s.bytes));
    expect(await provider(s, request).submit(s.context)).toMatchObject({ status: 'processing', checkpoint: { providerJobId: 'prediction-1' } });
    s.job.attempt!.checkpoint = undefined;
    expect(await provider(s, request).poll(s.context)).toMatchObject({ status: 'completed' });
    expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(String(request.mock.calls[1][0])).toBe('https://api.replicate.com/v1/predictions/prediction-1');
  });
  it('keeps an unknown POST without an identifier unreplayable', async () => {
    const s = await fixture(); const request = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Connection lost'));
    await expect(provider(s, request).submit(s.context)).rejects.toThrow('Connection lost');
    await expect(provider(s, request).poll(s.context)).rejects.toThrow();
    await expect(provider(s, request).submit(s.context)).rejects.toThrow();
    expect(request).toHaveBeenCalledOnce();
  });
  it('retains a billed synchronous result after the lease checkpoint is lost', async () => {
    const s = await fixture(); const checkpoint = s.context.checkpoint as ReturnType<typeof vi.fn>;
    checkpoint.mockImplementationOnce(async () => {}).mockRejectedValueOnce(new Error('Lease lost'));
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ id: 'prediction-1', status: 'succeeded', output: 'https://replicate.delivery/output.png' })).mockResolvedValueOnce(new Response(s.bytes));
    await expect(provider(s, request).submit(s.context)).rejects.toThrow('Lease lost');
    expect(await provider(s, request).poll(s.context)).toMatchObject({ status: 'completed' });
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('rejects unowned inputs before any vendor request and distinguishes known rejection from uncertainty', async () => {
    const s = await fixture(); const request = vi.fn<typeof fetch>();
    s.context.input = { ...s.input, ownerId: 'another-owner' };
    await expect(provider(s, request).submit(s.context)).rejects.toBeInstanceOf(DefinitiveProviderError);
    expect(request).not.toHaveBeenCalled();
    s.context.input = s.input; request.mockResolvedValue(new Response('', { status: 422 }));
    await expect(provider(s, request).submit(s.context)).rejects.toBeInstanceOf(DefinitiveProviderError);
  });
  it('does not fetch an unapproved output host or settle resized/invalid output', async () => {
    const s = await fixture(); const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: 'prediction-1', status: 'succeeded', output: 'https://unapproved.test/output.png' }));
    await expect(provider(s, request).submit(s.context)).rejects.toThrow(); expect(request).toHaveBeenCalledOnce();
    const resized = await sharp(s.bytes).resize(2, 2).png().toBuffer();
    request.mockResolvedValueOnce(Response.json({ id: 'prediction-1', status: 'succeeded', output: 'https://replicate.delivery/output.png' })).mockResolvedValueOnce(new Response(resized));
    await expect(provider(s, request).poll(s.context)).rejects.toThrow();
    expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });
});

  it('validates the sealed source-bound object mask before POST and keeps normalized inputs through unknown outcomes', async () => {
    if (operation !== 'object-removal') return;
    const s = await fixture(); const request = vi.fn<typeof fetch>().mockRejectedValue(new Error('Unknown connection outcome'));
    const mask = s.context.mask!;
    for (const bad of [undefined, { ...mask, parentArtifactId: 'other' }, { ...mask, ownerId: 'other' }, { ...mask, sealed: false }]) {
      s.context.mask = bad;
      await expect(provider(s, request).submit(s.context)).rejects.toBeInstanceOf(DefinitiveProviderError);
    }
    expect(request).not.toHaveBeenCalled(); s.context.mask = mask;
    await expect(provider(s, request).submit(s.context)).rejects.toThrow('Unknown connection outcome');
    const staged = [...s.objects.entries()].filter(([key]) => /^processing\/(inputs|masks)\/owner-1\/provider-.*\.png$/.test(key));
    expect(staged).toHaveLength(2);
    for (const [, value] of staged) expect(await sharp(value.bytes).metadata()).toMatchObject({ format: 'png', width: 4, height: 2 });
    const selected = staged.find(([key]) => key.startsWith('processing/masks/'))!;
    const raw = await sharp(selected[1].bytes).removeAlpha().raw().toBuffer();
    expect([...raw].every(value => value === 0 || value === 255)).toBe(true); expect(raw.includes(255)).toBe(true);
    await expect(provider(s, request).poll(s.context)).rejects.toThrow();
    expect(request).toHaveBeenCalledOnce();
    expect([...s.objects.keys()].filter(key => /^processing\/(inputs|masks)\/owner-1\/provider-.*\.png$/.test(key))).toHaveLength(2);
  });
});
