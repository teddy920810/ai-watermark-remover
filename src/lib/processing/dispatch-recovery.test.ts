import { describe, expect, it, vi } from 'vitest';
import { ProcessingDispatchRecovery } from './dispatch-recovery';
import { ProcessingWorker } from './processing-worker';
import type { AttemptResult, ProcessingJob } from './contracts';
import { MemoryArtifacts, MemoryFinance, MemoryJobs, NOW, source } from './test-fixtures';

async function setup(patch: Partial<ProcessingJob> = {}) {
  const jobs = new MemoryJobs(); const finance = new MemoryFinance(); let time = Date.parse(NOW); let sequence = 0;
  const quote = { id: 'q', ownerId: 'user-1', operation: 'image-watermark-pro' as const, inputArtifactId: 'input', amount: 3, unit: 'processingCredits' as const, priceVersion: 'v1', fingerprint: 'f', createdAt: NOW, expiresAt: NOW };
  const job: ProcessingJob = { id: 'job', ownerId: 'user-1', quote, operation: quote.operation, inputArtifactId: 'input', status: 'QUEUED', chargeStatus: 'reserved', createdAt: NOW, updatedAt: NOW, ...patch };
  await jobs.create(job);
  await finance.reserveAndEnqueue({ jobId: job.id, ownerId: job.ownerId, idempotencyKey: 'key', requestHash: 'hash', amount: 3, unit: 'processingCredits', now: NOW });
  const recovery = new ProcessingDispatchRecovery({ jobs, finance, now: () => new Date(time), id: () => `dispatch-${++sequence}` });
  return { jobs, finance, recovery, job, setTime: (minutes: number) => { time = Date.parse(NOW) + minutes * 60_000; } };
}

describe('durable dispatch recovery', () => {
  it('refunds at the logical deadline and retains a valid late result for saving without another provider call or charge', async () => {
    const s = await setup({ status: 'UNKNOWN', attempt: { id: 'paid-attempt', startedAt: NOW }, dispatch: { id: 'lost-original', startedAt: NOW, executionRef: 'uncertain:lost-original' } });
    const artifact = source({ id: 'late-result', role: 'result', key: 'processing/late-result.jpg', parentArtifactId: 'input' });
    await s.jobs.recordAttemptResult({ jobId: 'job', attemptId: 'paid-attempt', artifact, receivedAt: '2026-10-25T00:01:00.000Z' });
    const complete = vi.spyOn(s.finance, 'completeOutbox'); const refund = vi.spyOn(s.finance, 'refund');
    s.setTime(1441);
    expect(await s.recovery.recover('job')).toMatchObject({ status: 'SAVING', chargeStatus: 'refunded', pendingResult: artifact, refundIntent: { reason: 'unknown_timeout' } });
    expect(await s.finance.getBalance('user-1')).toBe(100); expect(s.finance.refunds).toBe(1); expect(complete).not.toHaveBeenCalled();
    await s.recovery.recover('job'); expect(refund).toHaveBeenCalledTimes(1);
    // A known stored result can start saving even when the original execution
    // cannot be found in the bounded listing; this never starts Provider work.
    await s.recovery.accepted('job', 'lost-original', 'uncertain:lost-original', false);
    const prepared = await s.recovery.prepare('job'); expect(prepared.start).toBe(true); expect(prepared.dispatchId).not.toBe('lost-original');
    await s.recovery.accepted('job', prepared.dispatchId, 'saving-execution', true);
    expect((await s.jobs.get('job'))!.job.dispatch).toMatchObject({ executionRef: 'saving-execution', terminal: true });
    const artifacts = new MemoryArtifacts(); artifacts.stored.add(artifact.key);
    const provider = { submit: vi.fn(), poll: vi.fn() };
    const worker = new ProcessingWorker({ jobs: s.jobs, artifacts, finance: s.finance, provider, now: () => new Date('2026-10-25T00:01:00.000Z') });
    expect(await worker.run('job', 'late-result-worker', prepared.dispatchId)).toMatchObject({ status: 'READY', chargeStatus: 'refunded', resultArtifactId: artifact.id });
    expect(provider.submit).not.toHaveBeenCalled(); expect(provider.poll).not.toHaveBeenCalled(); expect(s.finance.settlements).toBe(0); expect(s.finance.refunds).toBe(1);
  });
  it('adopts a late attempt record when an already refunded job is reconciled again', async () => {
    const s = await setup({ status: 'UNKNOWN', attempt: { id: 'paid-attempt', startedAt: NOW } }); s.setTime(1441);
    expect((await s.recovery.recover('job')).status).toBe('REFUNDED');
    const artifact = source({ id: 'late-result', role: 'result', parentArtifactId: 'input' });
    await s.jobs.recordAttemptResult({ jobId: 'job', attemptId: 'paid-attempt', artifact, receivedAt: '2026-10-25T00:02:00.000Z' });
    const refund = vi.spyOn(s.finance, 'refund'); const complete = vi.spyOn(s.finance, 'completeOutbox'); s.setTime(1442);
    expect(await s.recovery.recover('job')).toMatchObject({ status: 'SAVING', chargeStatus: 'refunded', pendingResult: artifact });
    expect(refund).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled(); expect(s.finance.refunds).toBe(1);
  });
  it.each(['job', 'attempt', 'owner', 'parent', 'role', 'sealed', 'metadata'] as const)('does not adopt a late result with invalid %s binding', async (invalid) => {
    const s = await setup({ status: 'UNKNOWN', attempt: { id: 'paid-attempt', startedAt: NOW } }); s.setTime(1441);
    const result: AttemptResult = { jobId: 'job', attemptId: 'paid-attempt', artifact: source({ id: 'late-result', role: 'result', parentArtifactId: 'input' }), receivedAt: NOW };
    if (invalid === 'job') result.jobId = 'other-job';
    if (invalid === 'attempt') result.attemptId = 'other-attempt';
    if (invalid === 'owner') result.artifact.ownerId = 'other-owner';
    if (invalid === 'parent') result.artifact.parentArtifactId = 'other-input';
    if (invalid === 'role') result.artifact.role = 'source';
    if (invalid === 'sealed') result.artifact.sealed = false;
    if (invalid === 'metadata') result.artifact.metadata.width = 0;
    s.jobs.attempts.set('job/paid-attempt', result);
    expect(await s.recovery.recover('job')).toMatchObject({ status: 'REFUNDED', chargeStatus: 'refunded' });
    expect((await s.jobs.get('job'))!.job.pendingResult).toBeUndefined(); expect(s.finance.refunds).toBe(1);
  });
  it('journals the nonce before posting and recovers a lost outbox acknowledgement without another start', async () => {
    const s = await setup();
    const first = await s.recovery.prepare('job');
    expect(first).toMatchObject({ start: true, dispatchId: 'dispatch-1' });
    expect((await s.jobs.get('job'))!.job.dispatch).toMatchObject({ id: 'dispatch-1', executionRef: 'uncertain:dispatch-1' });
    // Both a crash before POST and a lost POST response must consult the journal.
    expect(await s.recovery.prepare('job')).toMatchObject({ start: false, executionRef: 'uncertain:dispatch-1', dispatchId: 'dispatch-1' });
    await s.recovery.accepted('job', first.dispatchId, 'execution-1', false);
    expect(await s.recovery.prepare('job')).toMatchObject({ start: false, executionRef: 'execution-1' });
  });
  it('journals a fresh nonce only after a known terminal execution and ignores stale acknowledgements', async () => {
    const s = await setup(); const first = await s.recovery.prepare('job');
    await s.recovery.accepted('job', first.dispatchId, 'execution-1', true);
    const second = await s.recovery.prepare('job');
    expect(second.start).toBe(true); expect(second.dispatchId).not.toBe(first.dispatchId);
    await s.recovery.accepted('job', first.dispatchId, 'stale-execution', false);
    expect(await s.recovery.prepare('job')).toMatchObject({ start: false, executionRef: `uncertain:${second.dispatchId}` });
  });
  it('bounds an undelivered reservation by its creation time and refunds exactly once', async () => {
    const s = await setup(); await s.recovery.prepare('job'); s.setTime(14);
    expect((await s.recovery.recover('job')).chargeStatus).toBe('reserved');
    s.setTime(16); expect(await s.recovery.recover('job')).toMatchObject({ status: 'REFUNDED', chargeStatus: 'refunded', error: 'dispatch_timeout' });
    await s.recovery.recover('job'); expect(s.finance.refunds).toBe(1); expect(await s.finance.getBalance('user-1')).toBe(100); expect(s.finance.outbox.size).toBe(0);
  });
  it.each(['before-commit', 'after-commit'] as const)('resumes a durable refund intent after a failure %s', async (phase) => {
    const s = await setup(); s.setTime(16); const original = s.finance.refund.bind(s.finance);
    const refund = vi.spyOn(s.finance, 'refund').mockImplementationOnce(async (id, owner) => { if (phase === 'after-commit') await original(id, owner); throw new Error('response lost'); });
    await expect(s.recovery.recover('job')).rejects.toThrow('response lost');
    expect((await s.jobs.get('job'))!.job.refundIntent).toMatchObject({ reason: 'dispatch_timeout' });
    refund.mockRestore(); s.setTime(18);
    expect(await s.recovery.recover('job')).toMatchObject({ status: 'REFUNDED', chargeStatus: 'refunded' }); expect(s.finance.refunds).toBe(1);
  });
  it('uses the immutable attempt deadline even when no worker reached UNKNOWN', async () => {
    const s = await setup({ status: 'SUBMITTING', attempt: { id: 'paid-attempt', startedAt: '2026-10-24T00:10:00.000Z' } });
    s.setTime(16); expect((await s.recovery.recover('job')).chargeStatus).toBe('reserved');
    s.setTime(1451); expect(await s.recovery.recover('job')).toMatchObject({ status: 'REFUNDED', error: 'unknown_timeout' }); expect(s.finance.refunds).toBe(1);
  });
  it.each(['lease', 'pendingResult', 'SAVING', 'SETTLING'] as const)('does not refund a live or saved operation: %s', async (kind) => {
    const s = await setup(kind === 'lease' ? { lease: { owner: 'active', epoch: 1, expiresAt: '2026-10-26T00:00:00.000Z' } } : kind === 'pendingResult' ? { pendingResult: { id: 'output' } as ProcessingJob['pendingResult'] } : { status: kind });
    s.setTime(1500); await s.recovery.recover('job'); expect(s.finance.refunds).toBe(0);
  });
  it('never reports refunded when the ledger has already settled', async () => {
    const s = await setup(); await s.finance.settle('job', 'user-1'); s.setTime(16);
    expect((await s.recovery.recover('job')).status).not.toBe('REFUNDED'); expect(s.finance.refunds).toBe(0);
  });
});
