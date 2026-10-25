import { randomUUID } from 'node:crypto';
import { metadataSchema, ProcessingError } from './contracts';
import type { AttemptResult, ProcessingFinancialStore, ProcessingJob, ProcessingJobStore } from './contracts';

interface RecoveryOptions { jobs: ProcessingJobStore; finance: ProcessingFinancialStore; now?: () => Date; id?: () => string }
const hasRefundedPendingResult = (job: ProcessingJob) => job.chargeStatus === 'refunded' && Boolean(job.pendingResult) && ['SAVING', 'SETTLING'].includes(job.status);
function validLateArtifact(job: ProcessingJob, result: AttemptResult | null) {
  if (!result || result.jobId !== job.id || result.attemptId !== job.attempt?.id) return undefined;
  const artifact = result.artifact;
  if (!artifact || artifact.ownerId !== job.ownerId || artifact.parentArtifactId !== job.inputArtifactId || artifact.role !== 'result' || !artifact.sealed || !metadataSchema.safeParse(artifact.metadata).success) return undefined;
  if (artifact.metadata.kind !== (job.operation === 'video-watermark' ? 'video' : 'image')) return undefined;
  return artifact;
}
export class ProcessingDispatchRecovery {
  private readonly now: () => Date;
  private readonly id: () => string;
  constructor(private readonly options: RecoveryOptions) { this.now = options.now ?? (() => new Date()); this.id = options.id ?? randomUUID; }

  async prepare(jobId: string, existingRef?: string): Promise<{ start: boolean; dispatchId: string; executionRef?: string }> {
    for (let retry = 0; retry < 5; retry++) {
      const record = await this.options.jobs.get(jobId);
      if (!record) throw new ProcessingError('not_found', 'Task not found', 404);
      if ((record.job.refundIntent && !hasRefundedPendingResult(record.job)) || ['READY', 'FAILED', 'REFUNDED', 'EXPIRED'].includes(record.job.status)) throw new ProcessingError('dispatch_closed', 'Task is no longer awaiting dispatch', 409);
      if (record.job.dispatch && !record.job.dispatch.terminal) return { start: false, dispatchId: record.job.dispatch.id, executionRef: record.job.dispatch.executionRef };
      const inherited = !record.job.dispatch ? existingRef : undefined;
      const id = inherited?.startsWith('uncertain:') ? inherited.slice('uncertain:'.length) : this.id();
      if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) throw new Error('Invalid dispatch identifier');
      const dispatch = { id, startedAt: this.now().toISOString(), executionRef: inherited ?? `uncertain:${id}` };
      if (await this.options.jobs.compareAndSwap(jobId, record.version, { ...record.job, dispatch })) return { start: !inherited, dispatchId: id, ...(inherited ? { executionRef: inherited } : {}) };
    }
    throw new Error('Dispatch journal is busy');
  }

  async accepted(jobId: string, dispatchId: string, executionRef?: string, terminal = false): Promise<void> {
    for (let retry = 0; retry < 5; retry++) {
      const record = await this.options.jobs.get(jobId);
      if (!record || record.job.dispatch?.id !== dispatchId || (record.job.refundIntent && !hasRefundedPendingResult(record.job))) return;
      if (record.job.dispatch.terminal && !terminal) return;
      const dispatch = { ...record.job.dispatch, ...(executionRef ? { executionRef } : {}), terminal };
      if (await this.options.jobs.compareAndSwap(jobId, record.version, { ...record.job, dispatch })) return;
    }
    throw new Error('Dispatch acknowledgement needs recovery');
  }

  /** Non-billable coordinator: it never calls Provider submit or poll. */
  async recover(jobId: string): Promise<ProcessingJob> {
    const { jobs, finance } = this.options;
    const record = await jobs.get(jobId);
    if (!record) throw new ProcessingError('not_found', 'Task not found', 404);
    const job = record.job; const time = this.now().getTime();
    if (['READY', 'EXPIRED'].includes(job.status) || (!job.refundIntent && job.status === 'FAILED')) return job;
    if (job.lease && Date.parse(job.lease.expiresAt) > time) return job;
    if ((!job.refundIntent || job.chargeStatus === 'refunded') && (job.pendingResult || ['SAVING', 'SETTLING'].includes(job.status))) return job;
    const alreadyRefunded = job.status === 'REFUNDED' && job.chargeStatus === 'refunded';
    const existingLate = alreadyRefunded && job.attempt ? validLateArtifact(job, await jobs.getAttemptResult(jobId, job.attempt.id)) : undefined;
    if (alreadyRefunded && !existingLate) return job;
    const attemptDeadline = job.attempt ? Date.parse(job.attempt.startedAt) + 24 * 60 * 60_000 : Infinity;
    const confirmationDeadline = job.unknownUntil ? Date.parse(job.unknownUntil) : Infinity;
    const deadline = job.attempt ? Math.min(attemptDeadline, Number.isFinite(confirmationDeadline) ? confirmationDeadline : Infinity) : Date.parse(job.createdAt) + 15 * 60_000;
    if (!job.refundIntent && !alreadyRefunded && (!Number.isFinite(deadline) || time < deadline)) return job;
    const admission = await finance.getAdmission(jobId);
    if (!admission || admission.ownerId !== job.ownerId || admission.amount !== job.quote.amount || admission.unit !== job.quote.unit) throw new ProcessingError('admission_missing', 'Task has no valid financial admission', 409);
    if (admission.status === 'settled') return job;
    const intent = job.refundIntent ?? { reason: job.attempt ? 'unknown_timeout' as const : 'dispatch_timeout' as const, requestedAt: this.now().toISOString() };
    const lease = { owner: `recovery-${this.id()}`, epoch: (job.lease?.epoch ?? 0) + 1, expiresAt: new Date(time + 60_000).toISOString() };
    // The fence and the lease are one CAS. A delayed worker cannot write its
    // SUBMITTING attempt after this point, even if finance is temporarily down.
    const fenced = { ...job, refundIntent: intent, lease, updatedAt: this.now().toISOString() };
    if (!await jobs.compareAndSwap(jobId, record.version, fenced)) return (await jobs.get(jobId))!.job;
    if (admission.status !== 'refunded') await finance.refund(jobId, job.ownerId, intent.reason);
    const confirmed = await finance.getAdmission(jobId);
    if (confirmed?.status !== 'refunded') throw new Error('Refund acknowledgement needs recovery');
    // The deadline still refunds first. Existing immutable results are only
    // scheduled for private-byte verification and saving, never Provider work.
    const late = existingLate ?? (job.attempt ? validLateArtifact(job, await jobs.getAttemptResult(jobId, job.attempt.id)) : undefined);
    const current = await jobs.get(jobId);
    if (current?.job.lease?.owner !== lease.owner || current.job.lease.epoch !== lease.epoch) return current!.job;
    const refunded: ProcessingJob = { ...current.job, status: late ? 'SAVING' : 'REFUNDED', chargeStatus: 'refunded', ...(late ? { pendingResult: late, ...(current.job.dispatch ? { dispatch: { ...current.job.dispatch, terminal: true } } : {}) } : {}), error: intent.reason, updatedAt: this.now().toISOString(), lease: { ...lease, expiresAt: this.now().toISOString() } };
    if (!await jobs.compareAndSwap(jobId, current.version, refunded)) return (await jobs.get(jobId))!.job;
    if (!late) await finance.completeOutbox(jobId);
    return refunded;
  }
}
