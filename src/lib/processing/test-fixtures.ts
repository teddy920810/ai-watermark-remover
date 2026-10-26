import type { Admission, AttemptResult, CreditUnit, ProcessingArtifact, ProcessingArtifactStore, ProcessingFinancialStore, ProcessingJob, ProcessingJobStore, ProcessingQuote, ProcessingQuoteStore, ReserveRequest, VersionedJob } from './contracts';
import { ProcessingError } from './contracts';

export const NOW = '2026-10-24T00:00:00.000Z';
export function source(overrides: Partial<ProcessingArtifact> = {}): ProcessingArtifact {
  return { id: 'input-1', ownerId: 'user-1', key: 'processing/input-1.jpg', role: 'source', sealed: true, sha256: 'abc', metadata: { kind: 'image', contentType: 'image/jpeg', byteSize: 100, width: 100, height: 100 }, createdAt: NOW, expiresAt: '2026-10-26T00:00:00.000Z', ...overrides };
}
export class MemoryJobs implements ProcessingJobStore {
  data = new Map<string, VersionedJob>();
  attempts = new Map<string, AttemptResult>();
  async create(job: ProcessingJob) { if (this.data.has(job.id)) return false; this.data.set(job.id, { job: structuredClone(job), version: '1' }); return true; }
  async get(id: string) { return structuredClone(this.data.get(id) ?? null); }
  async compareAndSwap(id: string, version: string, job: ProcessingJob) { const current = this.data.get(id); if (!current || current.version !== version) return false; this.data.set(id, { job: structuredClone(job), version: String(Number(version) + 1) }); return true; }
  async recordAttemptResult(result: AttemptResult) { const key = `${result.jobId}/${result.attemptId}`; if (!this.attempts.has(key)) this.attempts.set(key, structuredClone(result)); }
  async getAttemptResult(jobId: string, attemptId: string) { return structuredClone(this.attempts.get(`${jobId}/${attemptId}`) ?? null); }
}
export class MemoryArtifacts implements ProcessingArtifactStore {
  data = new Map<string, ProcessingArtifact>();
  stored = new Set<string>();
  async get(id: string) { return structuredClone(this.data.get(id) ?? null); }
  async create(artifact: ProcessingArtifact) { this.data.set(artifact.id, structuredClone(artifact)); }
  async verifyStored(artifact: ProcessingArtifact) { if (!this.stored.has(artifact.key)) throw new Error('Result bytes are not stored'); }
}
export class MemoryQuotes implements ProcessingQuoteStore {
  data = new Map<string, ProcessingQuote>();
  async get(id: string) { return structuredClone(this.data.get(id) ?? null); }
  async create(quote: ProcessingQuote) { this.data.set(quote.id, structuredClone(quote)); }
}
export class MemoryFinance implements ProcessingFinancialStore {
  balances = new Map([['user-1', 100]]);
  freeBalances = new Map<string, number>();
  admissions = new Map<string, Admission>();
  admissionTimes = new Map<string, string>();
  outbox = new Set<string>();
  settlements = 0;
  refunds = 0;
  async getBalance(ownerId: string, unit: CreditUnit = 'processingCredits') { return (unit === 'freeUses' ? this.freeBalances : this.balances).get(ownerId) ?? 0; }
  async findAdmission(ownerId: string, key: string) { return [...this.admissions.values()].find((a) => a.ownerId === ownerId && a.idempotencyKey === key) ?? null; }
  async getAdmission(jobId: string) { return this.admissions.get(jobId) ?? null; }
  async listAdmissionsForOwner(ownerId: string, limit = 20, before?: { createdAt: string; jobId: string }) {
    const records = [...this.admissions.values()].filter((entry) => entry.ownerId === ownerId)
      .map((entry) => ({ admission: entry, createdAt: this.admissionTimes.get(entry.jobId) ?? NOW }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.admission.jobId.localeCompare(a.admission.jobId))
      .filter((entry) => !before || entry.createdAt < before.createdAt || entry.createdAt === before.createdAt && entry.admission.jobId < before.jobId);
    const page = records.slice(0, limit); const last = page.at(-1);
    return { admissions: page.map((entry) => structuredClone(entry.admission)), ...(records.length > limit && last ? { nextCursor: { createdAt: last.createdAt, jobId: last.admission.jobId } } : {}) };
  }
  async reserveAndEnqueue(request: ReserveRequest) {
    const existing = await this.findAdmission(request.ownerId, request.idempotencyKey);
    if (existing) { if (existing.requestHash !== request.requestHash) throw new ProcessingError('idempotency_conflict', 'Operation key already used', 409); return { admission: existing, created: false }; }
    const balance = await this.getBalance(request.ownerId, request.unit);
    if (balance < request.amount) throw new ProcessingError('insufficient_balance', 'Not enough processing credits', 402);
    (request.unit === 'freeUses' ? this.freeBalances : this.balances).set(request.ownerId, balance - request.amount);
    const admission: Admission = { ...request, status: 'reserved' };
    this.admissions.set(request.jobId, admission); this.admissionTimes.set(request.jobId, request.now); this.outbox.add(request.jobId);
    return { admission, created: true };
  }
  async settle(jobId: string, ownerId: string) { const a = this.admissions.get(jobId); if (!a || a.ownerId !== ownerId) throw new Error('Invalid admission'); if (a.status === 'reserved') { a.status = 'settled'; this.settlements++; } return a.status; }
  async refund(jobId: string, ownerId: string) { const a = this.admissions.get(jobId); if (!a || a.ownerId !== ownerId) throw new Error('Invalid admission'); if (a.status === 'reserved') { a.status = 'refunded'; this.refunds++; (a.unit === 'freeUses' ? this.freeBalances : this.balances).set(ownerId, (await this.getBalance(ownerId, a.unit)) + a.amount); } }
  async claimDue() { return []; }
  async enqueuePreflight(_ownerId: string, artifactId: string) { this.outbox.add(artifactId); }
  async recordDispatch() {}
  async retryDispatch() {}
  async completeOutbox(jobId: string) { this.outbox.delete(jobId); }
}
