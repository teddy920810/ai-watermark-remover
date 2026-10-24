import { describe, expect, it, vi } from 'vitest';
import { ProcessingWorker } from './processing-worker';
import { ProcessingService } from './processing-service';
import { DefinitiveProviderError, ProcessingError } from './contracts';
import type { ProcessingProviderContext, ProviderOutcome } from './contracts';
import { MemoryArtifacts, MemoryFinance, MemoryJobs, MemoryQuotes, NOW, source } from './test-fixtures';

async function setup() {
  const jobs = new MemoryJobs(); const artifacts = new MemoryArtifacts(); const quotes = new MemoryQuotes(); const finance = new MemoryFinance();
  artifacts.data.set('input-1', source());
  let now = NOW; let next = 0;
  const provider = { submit: vi.fn<(context: ProcessingProviderContext) => Promise<ProviderOutcome>>(), poll: vi.fn<(context: ProcessingProviderContext) => Promise<ProviderOutcome>>() };
  const result = source({ id: 'result-1', key: 'processing/result-1.jpg', role: 'result' });
  artifacts.stored.add(result.key); provider.submit.mockResolvedValue({ status: 'completed', artifact: result });
  const service = new ProcessingService({ jobs, artifacts, quotes, finance, inspector: { inspect: async () => source() }, capabilities: [{ operation: 'image-watermark', enabled: true, acceptedTypes: ['image/jpeg'], maxBytes: 1000 }], prices: { version: 'v1', amount: () => 1 }, now: () => new Date(now), id: () => `id-${++next}` });
  const q = await service.quote({ ownerId: 'user-1', operation: 'image-watermark', inputArtifactId: 'input-1' });
  const job = await service.submit({ ownerId: 'user-1', quoteId: q.id, idempotencyKey: 'first' });
  const worker = new ProcessingWorker({ jobs, artifacts, finance, provider, now: () => new Date(now), id: () => `attempt-${++next}` });
  return { jobs, artifacts, finance, provider, job, result, worker, setNow: (value: string) => { now = value; } };
}

describe('ProcessingWorker', () => {
  it.each(['verify', 'create', 'settle'] as const)('renews the saving lease through a slow %s phase and settles exactly once', async (phase) => {
    vi.useFakeTimers(); const s = await setup(); let resume!: () => void; const wait = new Promise<void>((resolve) => { resume = resolve; });
    const originalSettle = s.finance.settle.bind(s.finance); const originalCreate = s.artifacts.create.bind(s.artifacts);
    const blocked = phase === 'verify' ? vi.spyOn(s.artifacts, 'verifyStored').mockImplementationOnce(async () => wait)
      : phase === 'create' ? vi.spyOn(s.artifacts, 'create').mockImplementationOnce(async (artifact) => { await wait; await originalCreate(artifact); })
        : vi.spyOn(s.finance, 'settle').mockImplementationOnce(async (id, owner) => { await wait; return originalSettle(id, owner); });
    const running = s.worker.run(s.job.id, 'saving-worker');
    try {
      await vi.advanceTimersByTimeAsync(0); expect(blocked).toHaveBeenCalledTimes(1);
      for (const seconds of [20, 40, 60, 80]) { s.setNow(new Date(Date.parse(NOW) + seconds * 1000).toISOString()); await vi.advanceTimersByTimeAsync(20_000); }
      const current = (await s.jobs.get(s.job.id))!.job;
      expect(Date.parse(current.lease!.expiresAt)).toBeGreaterThan(Date.parse(NOW) + 80_000);
      expect((await s.worker.run(s.job.id, 'competing-worker')).lease?.owner).toBe('saving-worker');
      resume(); expect((await running).status).toBe('READY'); expect(s.finance.settlements).toBe(1); expect(s.provider.submit).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    } finally { resume(); await running; vi.useRealTimers(); }
  });
  it('does not settle after losing the saving lease during result verification', async () => {
    vi.useFakeTimers(); const s = await setup(); let resume!: () => void; const wait = new Promise<void>((resolve) => { resume = resolve; });
    vi.spyOn(s.artifacts, 'verifyStored').mockImplementationOnce(async () => wait);
    const running = s.worker.run(s.job.id, 'first');
    try {
      await vi.advanceTimersByTimeAsync(0); const current = (await s.jobs.get(s.job.id))!;
      await s.jobs.compareAndSwap(s.job.id, current.version, { ...current.job, lease: { owner: 'recovery', epoch: current.job.lease!.epoch + 1, expiresAt: '2026-10-24T00:05:00.000Z' } });
      s.setNow('2026-10-24T00:00:20.000Z'); await vi.advanceTimersByTimeAsync(20_000); resume();
      expect((await running).status).toBe('SAVING'); expect(s.finance.settlements).toBe(0); expect(s.provider.submit).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
      s.setNow('2026-10-24T00:06:00.000Z'); expect((await s.worker.run(s.job.id, 'third')).status).toBe('READY'); expect(s.finance.settlements).toBe(1); expect(s.provider.submit).toHaveBeenCalledTimes(1);
    } finally { resume(); await running; vi.useRealTimers(); }
  });
  it('serializes simultaneous provider checkpoints and lease heartbeats instead of fencing itself', async () => {
    const s = await setup(); s.provider.submit.mockImplementation(async (context) => { await Promise.all([context.checkpoint({ providerJobId: 'same-attempt' }), context.heartbeat(), context.heartbeat()]); return { status: 'completed', artifact: s.result }; });
    expect((await s.worker.run(s.job.id, 'one')).status).toBe('READY'); expect(s.finance.settlements).toBe(1); expect(s.provider.submit).toHaveBeenCalledTimes(1);
  });
  it('persists verified results before settling and never submits a completed task again', async () => {
    const s = await setup(); const verify = vi.spyOn(s.artifacts, 'verifyStored');
    expect((await s.worker.run(s.job.id, 'worker-1')).status).toBe('READY');
    await s.worker.run(s.job.id, 'worker-2');
    expect(verify).toHaveBeenCalledWith(s.result); expect(s.finance.settlements).toBe(1); expect(s.provider.submit).toHaveBeenCalledTimes(1);
  });
  it('enters UNKNOWN on an ambiguous image timeout and never automatically resubmits', async () => {
    const s = await setup(); s.provider.submit.mockRejectedValue(new Error('Network interrupted'));
    expect((await s.worker.run(s.job.id, 'worker-1')).status).toBe('UNKNOWN');
    s.setNow('2026-10-24T02:00:00.000Z'); await s.worker.run(s.job.id, 'worker-2');
    expect(s.provider.submit).toHaveBeenCalledTimes(1); expect(s.finance.refunds).toBe(0);
  });
  it('refunds UNKNOWN once after 24h and accepts a late result without charging again', async () => {
    const s = await setup(); s.provider.submit.mockRejectedValue(new Error('No response'));
    const unknown = await s.worker.run(s.job.id, 'one'); s.setNow('2026-10-25T00:01:00.000Z');
    expect((await s.worker.run(s.job.id, 'two')).status).toBe('REFUNDED');
    await s.worker.run(s.job.id, 'three'); expect(s.finance.refunds).toBe(1);
    await s.jobs.recordAttemptResult({ jobId: s.job.id, attemptId: unknown.attempt!.id, artifact: s.result, receivedAt: '2026-10-25T00:02:00.000Z' });
    const ready = await s.worker.run(s.job.id, 'four');
    expect(ready.status).toBe('READY'); expect(ready.chargeStatus).toBe('refunded'); expect(s.finance.settlements).toBe(0); expect(await s.finance.getBalance('user-1')).toBe(100);
  });
  it('refunds only a definite failure and preserves parent artifacts', async () => {
    const s = await setup(); s.provider.submit.mockRejectedValue(new DefinitiveProviderError('Rejected before acceptance'));
    expect((await s.worker.run(s.job.id, 'one')).status).toBe('FAILED');
    expect(s.finance.refunds).toBe(1); expect(s.artifacts.data.has('input-1')).toBe(true);
  });
  it('retries result persistence without rerunning the provider', async () => {
    const s = await setup(); s.artifacts.stored.clear();
    expect((await s.worker.run(s.job.id, 'one')).status).toBe('SAVING');
    expect(s.finance.settlements).toBe(0); s.artifacts.stored.add(s.result.key);
    expect((await s.worker.run(s.job.id, 'two')).status).toBe('READY');
    expect(s.provider.submit).toHaveBeenCalledTimes(1);
  });
  it('stores provider checkpoints and polls a known task instead of creating another one', async () => {
    const s = await setup();
    s.provider.submit.mockImplementation(async (context) => { await context.checkpoint({ providerJobId: 'vendor-1' }); await context.heartbeat(); return { status: 'processing', checkpoint: { providerJobId: 'vendor-1' }, progress: 0.25 }; });
    expect(await s.worker.run(s.job.id, 'one')).toMatchObject({ status: 'PROCESSING', progress: 0.25, attempt: { checkpoint: { providerJobId: 'vendor-1' } } });
    s.provider.poll.mockResolvedValue({ status: 'completed', artifact: s.result });
    expect((await s.worker.run(s.job.id, 'two')).status).toBe('READY');
    expect(s.provider.submit).toHaveBeenCalledTimes(1); expect(s.provider.poll).toHaveBeenCalledTimes(1);
  });
  it('does not recover SUBMITTING by making a second upstream request after lease expiry', async () => {
    const s = await setup(); const current = await s.jobs.get(s.job.id);
    await s.jobs.compareAndSwap(s.job.id, current!.version, { ...s.job, status: 'SUBMITTING', attempt: { id: 'lost', startedAt: NOW }, lease: { owner: 'lost-worker', epoch: 1, expiresAt: NOW } });
    expect((await s.worker.run(s.job.id, 'new-worker')).status).toBe('UNKNOWN');
    expect(s.provider.submit).not.toHaveBeenCalled();
  });
  it('prevents concurrent workers from submitting the same operation', async () => {
    const s = await setup(); let release!: () => void; const wait = new Promise<void>((resolve) => { release = resolve; });
    s.provider.submit.mockImplementation(async () => { await wait; return { status: 'completed', artifact: s.result }; });
    const first = s.worker.run(s.job.id, 'first');
    await vi.waitFor(() => expect(s.provider.submit).toHaveBeenCalledTimes(1));
    expect((await s.worker.run(s.job.id, 'second')).status).toBe('SUBMITTING');
    release(); await first; expect(s.provider.submit).toHaveBeenCalledTimes(1);
  });
  it('does not execute a prepared orphan without a financial admission', async () => {
    const s = await setup(); s.finance.admissions.clear();
    await expect(s.worker.run(s.job.id, 'one')).rejects.toMatchObject({ code: 'admission_missing' });
    expect(s.provider.submit).not.toHaveBeenCalled();
  });
  it('honors the 24h logical refund deadline even when a late response arrives before reconciliation runs', async () => {
    const s = await setup(); s.provider.submit.mockRejectedValue(new Error('No response'));
    const unknown = await s.worker.run(s.job.id, 'one'); s.setNow('2026-10-25T01:00:00.000Z');
    await s.jobs.recordAttemptResult({ jobId: s.job.id, attemptId: unknown.attempt!.id, artifact: s.result, receivedAt: '2026-10-25T00:30:00.000Z' });
    expect(await s.worker.run(s.job.id, 'two')).toMatchObject({ status: 'READY', chargeStatus: 'refunded' });
    expect(await s.finance.getBalance('user-1')).toBe(100); expect(s.finance.settlements).toBe(0);
  });
  it('repairs a committed settlement whose response was lost without charging a second time', async () => {
    const s = await setup(); const settle = s.finance.settle.bind(s.finance);
    vi.spyOn(s.finance, 'settle').mockImplementationOnce(async (id, owner) => { await settle(id, owner); throw new Error('Commit response lost'); });
    expect((await s.worker.run(s.job.id, 'one')).status).toBe('SETTLING');
    expect((await s.worker.run(s.job.id, 'two')).status).toBe('READY');
    expect(s.finance.settlements).toBe(1); expect(s.provider.submit).toHaveBeenCalledTimes(1);
  });
  it('preserves a stale worker response for reconciliation instead of overwriting the new lease', async () => {
    const s = await setup(); let release!: () => void; const wait = new Promise<void>((resolve) => { release = resolve; });
    s.provider.submit.mockImplementation(async () => { await wait; return { status: 'completed', artifact: s.result }; });
    const first = s.worker.run(s.job.id, 'first'); await vi.waitFor(() => expect(s.provider.submit).toHaveBeenCalledTimes(1));
    s.setNow('2026-10-24T00:02:00.000Z'); expect((await s.worker.run(s.job.id, 'second')).status).toBe('UNKNOWN');
    release(); expect((await first).status).toBe('UNKNOWN');
    expect((await s.worker.run(s.job.id, 'third')).status).toBe('READY'); expect(s.provider.submit).toHaveBeenCalledTimes(1);
  });
  it('recovers an ambiguous known-video query by polling the same checkpoint', async () => {
    const s = await setup(); s.provider.submit.mockResolvedValue({ status: 'processing', checkpoint: { providerJobId: 'vendor-1' } });
    await s.worker.run(s.job.id, 'first'); s.provider.poll.mockRejectedValueOnce(new Error('Query interrupted')).mockResolvedValueOnce({ status: 'completed', artifact: s.result });
    expect((await s.worker.run(s.job.id, 'second')).status).toBe('UNKNOWN');
    expect((await s.worker.run(s.job.id, 'third')).status).toBe('READY'); expect(s.provider.submit).toHaveBeenCalledTimes(1);
  });
  it('recovers an image from the local provider receipt without a remote task ID or another paid submit', async () => {
    const s = await setup(); s.provider.submit.mockRejectedValue(new Error('Receipt registration interrupted'));
    await s.worker.run(s.job.id, 'first'); s.provider.poll.mockResolvedValue({ status: 'completed', artifact: s.result });
    expect((await s.worker.run(s.job.id, 'second')).status).toBe('READY');
    expect(s.provider.submit).toHaveBeenCalledTimes(1); expect(s.provider.poll).toHaveBeenCalledTimes(1);
  });
  it('keeps a missing image receipt UNKNOWN even if an adapter reports processing', async () => {
    const s = await setup(); s.provider.submit.mockRejectedValue(new Error('No response'));
    await s.worker.run(s.job.id, 'first'); s.provider.poll.mockResolvedValue({ status: 'processing', checkpoint: {} });
    expect((await s.worker.run(s.job.id, 'second')).status).toBe('UNKNOWN');
    expect(s.provider.submit).toHaveBeenCalledTimes(1);
  });
  it('recognizes an image provider receipt after the logical refund without recharging or resubmitting', async () => {
    const s = await setup(); s.provider.submit.mockRejectedValue(new Error('Registration failed'));
    await s.worker.run(s.job.id, 'first'); s.setNow('2026-10-25T01:00:00.000Z');
    expect((await s.worker.run(s.job.id, 'second')).status).toBe('REFUNDED');
    s.provider.poll.mockImplementation(async (context) => { await context.heartbeat(); await expect(context.checkpoint({ providerJobId: 'forbidden-new-request' })).rejects.toThrow('cannot submit'); return { status: 'completed', artifact: s.result }; });
    expect(await s.worker.run(s.job.id, 'third')).toMatchObject({ status: 'READY', chargeStatus: 'refunded' });
    expect(s.finance.settlements).toBe(0); expect(s.provider.submit).toHaveBeenCalledTimes(1);
  });
  it('does not classify receipt-storage ProcessingError as an upstream rejection', async () => {
    const s = await setup(); s.provider.submit.mockRejectedValue(new Error('Result receipt saved but registration interrupted'));
    await s.worker.run(s.job.id, 'first');
    s.provider.poll.mockRejectedValueOnce(new ProcessingError('storage_unavailable', 'Private metadata could not be read', 503)).mockResolvedValueOnce({ status: 'completed', artifact: s.result });
    expect((await s.worker.run(s.job.id, 'second')).status).toBe('UNKNOWN'); expect(s.finance.refunds).toBe(0);
    expect((await s.worker.run(s.job.id, 'third')).status).toBe('READY'); expect(s.provider.submit).toHaveBeenCalledTimes(1);
  });
});
