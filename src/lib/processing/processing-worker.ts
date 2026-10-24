import { randomUUID } from 'node:crypto';
import { DefinitiveProviderError, metadataSchema, ProcessingError } from './contracts';
import type { ProcessingArtifact, ProcessingArtifactStore, ProcessingFinancialStore, ProcessingJob, ProcessingJobStore, ProcessingProviderContext, ProcessingProviderPort, ProviderCheckpoint, ProviderOutcome } from './contracts';

export interface ProcessingWorkerOptions {
  jobs: ProcessingJobStore;
  artifacts: ProcessingArtifactStore;
  finance: ProcessingFinancialStore;
  provider: ProcessingProviderPort;
  now?: () => Date;
  id?: () => string;
  leaseMs?: number;
  unknownHoldMs?: number;
  resultTtlMs?: number;
}
class LeaseLost extends Error {}

export class ProcessingWorker {
  private readonly now: () => Date;
  private readonly id: () => string;
  constructor(private readonly options: ProcessingWorkerOptions) { this.now = options.now ?? (() => new Date()); this.id = options.id ?? randomUUID; }

  async run(jobId: string, workerId: string): Promise<ProcessingJob> {
    const { jobs, artifacts, finance, provider } = this.options;
    let record = await jobs.get(jobId);
    if (!record) throw new ProcessingError('not_found', 'Task not found', 404);
    const admission = await finance.getAdmission(jobId);
    if (!admission || admission.ownerId !== record.job.ownerId || admission.amount !== record.job.quote.amount || admission.unit !== record.job.quote.unit) throw new ProcessingError('admission_missing', 'Task has no valid financial admission', 409);
    const currentTime = this.now().getTime();
    if (record.job.lease && Date.parse(record.job.lease.expiresAt) > currentTime) return record.job;
    const epoch = (record.job.lease?.epoch ?? 0) + 1;
    const lease = { owner: workerId, epoch, expiresAt: new Date(currentTime + (this.options.leaseMs ?? 60_000)).toISOString() };
    if (!await jobs.compareAndSwap(jobId, record.version, { ...record.job, chargeStatus: admission.status, lease })) return (await jobs.get(jobId))!.job;

    const read = async () => (await jobs.get(jobId))!.job;
    let updates: Promise<void> = Promise.resolve();
    const update = (patch: Partial<ProcessingJob> | ((current: ProcessingJob) => Partial<ProcessingJob>)): Promise<ProcessingJob> => {
      const pending = updates.then(async () => {
        record = await jobs.get(jobId);
        if (!record || record.job.lease?.owner !== workerId || record.job.lease.epoch !== epoch || Date.parse(record.job.lease.expiresAt) < this.now().getTime()) throw new LeaseLost();
        const next = { ...record.job, ...(typeof patch === 'function' ? patch(record.job) : patch), updatedAt: this.now().toISOString() };
        if (!await jobs.compareAndSwap(jobId, record.version, next)) throw new LeaseLost();
        return next;
      });
      // Provider checkpoint writes, timer heartbeats and state changes share one
      // queue. Parallel writes from this same fenced worker must not race CAS.
      updates = pending.then(() => undefined, () => undefined);
      return pending;
    };
    const heartbeat = async () => { await update((current) => ({ lease: { ...current.lease!, expiresAt: new Date(this.now().getTime() + (this.options.leaseMs ?? 60_000)).toISOString() } })); };
    const withSavingLease = async <T>(work: () => Promise<T>): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let pending: Promise<void> | undefined;
      let stopped = false; let heartbeatError: unknown;
      const tick = () => {
        pending = heartbeat().catch((error: unknown) => { heartbeatError = error; }).then(() => {
          if (!stopped && !heartbeatError) timer = setTimeout(tick, Math.max(1, Math.floor((this.options.leaseMs ?? 60_000) / 3)));
        });
      };
      await heartbeat();
      timer = setTimeout(tick, Math.max(1, Math.floor((this.options.leaseMs ?? 60_000) / 3)));
      try {
        const value = await work();
        if (pending) await pending;
        if (heartbeatError) throw heartbeatError;
        await heartbeat();
        return value;
      } finally {
        stopped = true; if (timer) clearTimeout(timer); if (pending) await pending;
      }
    };
    const release = async () => {
      const job = await read();
      if (job.lease?.owner === workerId && job.lease.epoch === epoch) {
        try { return await update({ lease: { ...job.lease, expiresAt: this.now().toISOString() } }); } catch { return read(); }
      }
      return job;
    };
    const unknown = async () => {
      const job = await read();
      return update({ status: 'UNKNOWN', error: 'provider_request_uncertain', unknownUntil: job.unknownUntil ?? new Date(this.now().getTime() + (this.options.unknownHoldMs ?? 24 * 60 * 60_000)).toISOString() });
    };
    const save = async (artifact: ProcessingArtifact) => {
      const job = await read();
      if (artifact.ownerId !== job.ownerId || artifact.role !== 'result' || !artifact.sealed) throw new ProcessingError('invalid_result', 'Invalid result ownership');
      metadataSchema.parse(artifact.metadata);
      await update({ status: 'SAVING', pendingResult: artifact });
      await withSavingLease(async () => {
        await artifacts.verifyStored(artifact);
        await heartbeat();
        await artifacts.create(artifact);
        await update({ status: 'SETTLING', resultArtifactId: artifact.id });
        const chargeStatus = await finance.settle(jobId, job.ownerId);
        await update({ status: 'READY', chargeStatus, resultArtifactId: artifact.id, pendingResult: undefined, progress: 1, error: undefined,
          expiresAt: new Date(this.now().getTime() + (this.options.resultTtlMs ?? 24 * 60 * 60_000)).toISOString() });
        await finance.completeOutbox(jobId);
      });
    };

    try {
      let job = await read();
      if (job.status === 'UNKNOWN' && job.unknownUntil && Date.parse(job.unknownUntil) <= this.now().getTime()) {
        await finance.refund(jobId, job.ownerId, 'unknown_timeout');
        job = await update({ status: 'REFUNDED', chargeStatus: 'refunded', error: 'unknown_timeout' });
      }
      const late = job.attempt ? await jobs.getAttemptResult(jobId, job.attempt.id) : null;
      if (late && job.status !== 'READY') { await save(late.artifact); return release(); }
      if (job.status === 'REFUNDED' && job.attempt && job.operation !== 'video-watermark') {
        let receipt: ProviderOutcome | undefined;
        try {
          const input = await artifacts.get(job.inputArtifactId);
          const mask = job.maskArtifactId ? await artifacts.get(job.maskArtifactId) : undefined;
          if (input?.ownerId === job.ownerId && input.sealed && (!mask || mask.ownerId === job.ownerId)) {
            receipt = await provider.poll({ job, input, ...(mask ? { mask } : {}),
              checkpoint: async () => { throw new Error('Refunded image recovery cannot submit another request'); },
              heartbeat,
            });
          }
        } catch { /* A missing local receipt never reopens or charges a refunded operation. */ }
        if (receipt?.status === 'completed') {
          await jobs.recordAttemptResult({ jobId, attemptId: job.attempt.id, artifact: receipt.artifact, receivedAt: this.now().toISOString() });
          await save(receipt.artifact);
        } else await finance.completeOutbox(jobId);
        return release();
      }
      if (job.status === 'READY' || job.status === 'EXPIRED' || job.status === 'FAILED' || job.status === 'REFUNDED') {
        await finance.completeOutbox(jobId); return release();
      }
      if (job.pendingResult) { await save(job.pendingResult); return release(); }
      if (admission.status === 'refunded') { await update({ status: 'REFUNDED', chargeStatus: 'refunded' }); return release(); }
      const input = await artifacts.get(job.inputArtifactId);
      const mask = job.maskArtifactId ? await artifacts.get(job.maskArtifactId) : undefined;
      if (!input || input.ownerId !== job.ownerId || !input.sealed || (job.maskArtifactId && (!mask || mask.ownerId !== job.ownerId))) throw new DefinitiveProviderError('Input unavailable');
      const context: ProcessingProviderContext = {
        job, input, ...(mask ? { mask } : {}),
        checkpoint: async (checkpoint: ProviderCheckpoint) => { await update((current) => ({ attempt: { ...current.attempt!, checkpoint: { ...current.attempt?.checkpoint, ...checkpoint } } })); },
        heartbeat,
      };
      let outcome: ProviderOutcome;
      if (job.attempt) {
        // Image adapters may only consult an immutable local receipt here. They
        // must never turn this recovery call into a second paid submission.
        outcome = await provider.poll(context);
        if (!job.attempt.checkpoint?.providerJobId && outcome.status !== 'completed') { if (job.status !== 'UNKNOWN') await unknown(); return release(); }
      } else {
        job = await update({ status: 'SUBMITTING', attempt: { id: this.id(), startedAt: this.now().toISOString() } });
        context.job = job;
        outcome = await provider.submit(context);
      }
      if (outcome.status === 'failed') throw new DefinitiveProviderError(outcome.message);
      if (outcome.status === 'processing') {
        const current = await read();
        const progress = outcome.progress;
        await update({ status: 'PROCESSING', attempt: { ...current.attempt!, checkpoint: { ...current.attempt?.checkpoint, ...outcome.checkpoint } },
          ...(typeof progress === 'number' && Number.isFinite(progress) && progress >= 0 && progress <= 1 ? { progress } : {}) });
      } else {
        const current = await read();
        await jobs.recordAttemptResult({ jobId, attemptId: current.attempt!.id, artifact: outcome.artifact, receivedAt: this.now().toISOString() });
        await save(outcome.artifact);
      }
    } catch (error) {
      if (error instanceof LeaseLost) return read();
      const job = await read();
      if (job.status === 'SAVING' || job.status === 'SETTLING' || job.status === 'READY') {
        // Stored output and the ledger are recoverable independently; never call the Provider again.
        if (job.status !== 'READY') await update({ error: 'result_recovery_pending' });
      } else if (error instanceof DefinitiveProviderError || (error instanceof ProcessingError && error.code === 'invalid_result')) {
        await finance.refund(jobId, job.ownerId, 'processing_failed');
        await update({ status: 'FAILED', chargeStatus: 'refunded', error: 'processing_failed' });
        await finance.completeOutbox(jobId);
      } else await unknown();
    }
    return release();
  }
}
