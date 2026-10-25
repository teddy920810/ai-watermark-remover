import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { amountSchema, ProcessingError } from './contracts';
import type { Admission, AdmissionHistoryCursor, AdmissionHistoryPage, ChargeStatus, CreditUnit, OutboxMessage, ProcessingFinancialStore, ReserveRequest } from './contracts';

interface AdmissionRow { job_id: string; owner_id: string; operation_key: string; request_hash: string; amount: number | string; unit: CreditUnit; status: ChargeStatus }
const integer = (value: number | string) => { const n = Number(value); if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid credit amount'); return n; };
const admission = (row: AdmissionRow): Admission => ({ jobId: row.job_id, ownerId: row.owner_id, idempotencyKey: row.operation_key, requestHash: row.request_hash, amount: integer(row.amount), unit: row.unit, status: row.status });

export class PostgresProcessingStore implements ProcessingFinancialStore {
  constructor(private readonly pool: Pool) {}

  async getBalance(ownerId: string, unit: CreditUnit = 'processingCredits'): Promise<number> {
    if (unit === 'freeUses') return this.transaction(async (client) => { await this.ensureFree(client, ownerId); return this.lockBalance(client, ownerId, unit); });
    const result = await this.pool.query<{ available_credits: string }>('SELECT available_credits FROM processing_accounts WHERE owner_id = $1', [ownerId]);
    return result.rows[0] ? integer(result.rows[0].available_credits) : 0;
  }

  async findAdmission(ownerId: string, idempotencyKey: string): Promise<Admission | null> {
    const result = await this.pool.query<AdmissionRow>('SELECT * FROM processing_admissions WHERE owner_id = $1 AND operation_key = $2', [ownerId, idempotencyKey]);
    return result.rows[0] ? admission(result.rows[0]) : null;
  }
  async getAdmission(jobId: string): Promise<Admission | null> {
    const result = await this.pool.query<AdmissionRow>('SELECT * FROM processing_admissions WHERE job_id = $1', [jobId]);
    return result.rows[0] ? admission(result.rows[0]) : null;
  }
  async listAdmissionsForOwner(ownerId: string, limit = 20, before?: AdmissionHistoryCursor): Promise<AdmissionHistoryPage> {
    const pageSize = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.trunc(limit))) : 20;
    // Keep PostgreSQL's timestamp precision: converting created_at to a JS Date
    // could skip admissions within the same millisecond on the next page.
    const result = await this.pool.query<AdmissionRow & { cursor_created_at: string }>(`
      SELECT *, created_at::text AS cursor_created_at FROM processing_admissions
      WHERE owner_id = $1
        AND ($2::timestamptz IS NULL OR (created_at, job_id) < ($2::timestamptz, $3::text))
      ORDER BY created_at DESC, job_id DESC LIMIT $4
    `, [ownerId, before?.createdAt ?? null, before?.jobId ?? null, pageSize + 1]);
    const rows = result.rows.slice(0, pageSize); const last = rows.at(-1);
    return { admissions: rows.map(admission), ...(result.rows.length > pageSize && last ? { nextCursor: { createdAt: last.cursor_created_at, jobId: last.job_id } } : {}) };
  }

  async reserveAndEnqueue(request: ReserveRequest): Promise<{ admission: Admission; created: boolean }> {
    amountSchema.parse(request.amount);
    if (request.unit === 'freeUses' && request.amount !== 1) throw new ProcessingError('invalid_free_reservation', 'A normal image uses one free use');
    return this.transaction(async (client) => {
      // Every admission locks the independent account first, including free-use requests.
      await this.ensureAccount(client, request.ownerId);
      await this.lockBalance(client, request.ownerId, 'processingCredits');
      const existing = await client.query<AdmissionRow>('SELECT * FROM processing_admissions WHERE owner_id = $1 AND operation_key = $2', [request.ownerId, request.idempotencyKey]);
      if (existing.rows[0]) {
        const prior = admission(existing.rows[0]);
        if (prior.requestHash !== request.requestHash || prior.amount !== request.amount || prior.unit !== request.unit) throw new ProcessingError('idempotency_conflict', 'Operation key belongs to another request', 409);
        return { admission: prior, created: false };
      }
      if (request.unit === 'freeUses') await this.ensureFree(client, request.ownerId);
      const balance = await this.lockBalance(client, request.ownerId, request.unit);
      if (balance < request.amount) throw new ProcessingError('insufficient_balance', request.unit === 'freeUses' ? 'No free uses remaining; confirm a new quote' : 'Not enough processing credits', 402);
      if (request.unit === 'freeUses') {
        const updated = await client.query<{ balance: number }>('UPDATE user_benefits SET balance = balance - 1, last_active_at = NOW() WHERE user_id = $1 RETURNING balance', [request.ownerId]);
        await client.query("INSERT INTO job_credit_reservations (job_id, user_id, status) VALUES ($1, $2, 'reserved')", [request.jobId, request.ownerId]);
        await client.query("INSERT INTO benefit_ledger (user_id, delta, balance_after, reason, reference_id) VALUES ($1, -1, $2, 'job_reserve', $3)", [request.ownerId, updated.rows[0].balance, request.jobId]);
      } else {
        const updated = await client.query<{ available_credits: string }>('UPDATE processing_accounts SET available_credits = available_credits - $2, updated_at = NOW() WHERE owner_id = $1 RETURNING available_credits', [request.ownerId, request.amount]);
        await this.ledger(client, request.ownerId, -request.amount, integer(updated.rows[0].available_credits), 'reserve', request.jobId);
      }
      await client.query("INSERT INTO processing_admissions (job_id, owner_id, operation_key, request_hash, amount, unit, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,'reserved',$7)", [request.jobId, request.ownerId, request.idempotencyKey, request.requestHash, request.amount, request.unit, request.now]);
      await this.enqueue(client, request.ownerId, request.jobId, 'process', request.now);
      return { admission: { ...request, status: 'reserved' }, created: true };
    });
  }

  async enqueuePreflight(ownerId: string, artifactId: string, now: string): Promise<void> { await this.enqueue(this.pool, ownerId, artifactId, 'preflight', now); }

  async grantCredits(ownerId: string, amount: number, reference: string, actorId: string): Promise<{ granted: boolean; balance: number }> {
    if (!Number.isSafeInteger(amount) || amount <= 0 || !ownerId || !actorId?.trim() || !/^[a-zA-Z0-9:_-]{1,160}$/.test(reference)) throw new ProcessingError('invalid_grant', 'Grant requires a positive integer, administrator and audit reference');
    return this.transaction(async (client) => {
      await this.ensureAccount(client, ownerId); const before = await this.lockBalance(client, ownerId, 'processingCredits');
      const existing = await client.query<{ delta: number | string; actor_id: string | null }>("SELECT delta, actor_id FROM processing_credit_ledger WHERE owner_id = $1 AND reason = 'grant' AND reference_id = $2", [ownerId, reference]);
      if (existing.rows[0]) {
        if (integer(existing.rows[0].delta) !== amount || existing.rows[0].actor_id !== actorId) throw new ProcessingError('grant_conflict', 'Audit reference belongs to a different grant amount or administrator', 409);
        return { granted: false, balance: before };
      }
      if (!Number.isSafeInteger(before + amount)) throw new ProcessingError('invalid_grant', 'Credit balance exceeds the supported amount');
      const updated = await client.query<{ available_credits: string }>('UPDATE processing_accounts SET available_credits = available_credits + $2, updated_at = NOW() WHERE owner_id = $1 RETURNING available_credits', [ownerId, amount]);
      const balance = integer(updated.rows[0].available_credits);
      await this.ledger(client, ownerId, amount, balance, 'grant', reference, actorId);
      return { granted: true, balance };
    });
  }

  async revokeCredits(ownerId: string, amount: number, reference: string, actorId: string): Promise<{ revoked: boolean; balance: number }> {
    if (!Number.isSafeInteger(amount) || amount <= 0 || !ownerId || !actorId?.trim() || !/^[a-zA-Z0-9:_-]{1,160}$/.test(reference)) throw new ProcessingError('invalid_revoke', 'Revocation requires a positive integer, administrator and audit reference');
    return this.transaction(async (client) => {
      await this.ensureAccount(client, ownerId); const before = await this.lockBalance(client, ownerId, 'processingCredits');
      const existing = await client.query<{ delta: number | string; actor_id: string | null }>("SELECT delta, actor_id FROM processing_credit_ledger WHERE owner_id = $1 AND reason = 'revoke' AND reference_id = $2", [ownerId, reference]);
      if (existing.rows[0]) {
        if (integer(-Number(existing.rows[0].delta)) !== amount || existing.rows[0].actor_id !== actorId) throw new ProcessingError('revoke_conflict', 'Audit reference belongs to a different revocation amount or administrator', 409);
        return { revoked: false, balance: before };
      }
      if (before < amount) throw new ProcessingError('insufficient_balance', 'Available processing credits are insufficient for this revocation', 409);
      const updated = await client.query<{ available_credits: string }>('UPDATE processing_accounts SET available_credits = available_credits - $2, updated_at = NOW() WHERE owner_id = $1 RETURNING available_credits', [ownerId, amount]);
      const balance = integer(updated.rows[0].available_credits);
      await this.ledger(client, ownerId, -amount, balance, 'revoke', reference, actorId);
      return { revoked: true, balance };
    });
  }

  async settle(jobId: string, ownerId: string): Promise<ChargeStatus> {
    return this.transaction(async (client) => {
      await this.ensureAccount(client, ownerId); const balance = await this.lockBalance(client, ownerId, 'processingCredits');
      const current = await this.lockAdmission(client, jobId, ownerId);
      if (current.status !== 'reserved') return current.status;
      await client.query("UPDATE processing_admissions SET status = 'settled', updated_at = NOW() WHERE job_id = $1", [jobId]);
      if (current.unit === 'freeUses') {
        await client.query("UPDATE job_credit_reservations SET status = 'consumed', updated_at = NOW() WHERE job_id = $1 AND user_id = $2 AND status = 'reserved'", [jobId, ownerId]);
        await client.query('UPDATE user_benefits SET last_active_at = NOW(), last_processed_at = NOW() WHERE user_id = $1', [ownerId]);
      } else await this.ledger(client, ownerId, 0, balance, 'settle', jobId);
      return 'settled';
    });
  }

  async refund(jobId: string, ownerId: string, reason: string): Promise<void> {
    await this.transaction(async (client) => {
      await this.ensureAccount(client, ownerId); await this.lockBalance(client, ownerId, 'processingCredits');
      const current = await this.lockAdmission(client, jobId, ownerId);
      if (current.status !== 'reserved') return;
      if (current.unit === 'freeUses') {
        await this.lockBalance(client, ownerId, 'freeUses');
        const updated = await client.query<{ balance: number }>('UPDATE user_benefits SET balance = balance + 1, last_active_at = NOW() WHERE user_id = $1 RETURNING balance', [ownerId]);
        await client.query("UPDATE job_credit_reservations SET status = 'refunded', updated_at = NOW() WHERE job_id = $1 AND user_id = $2 AND status = 'reserved'", [jobId, ownerId]);
        await client.query("INSERT INTO benefit_ledger (user_id, delta, balance_after, reason, reference_id) VALUES ($1, 1, $2, 'job_refund', $3)", [ownerId, updated.rows[0].balance, jobId]);
      } else {
        const updated = await client.query<{ available_credits: string }>('UPDATE processing_accounts SET available_credits = available_credits + $2, updated_at = NOW() WHERE owner_id = $1 RETURNING available_credits', [ownerId, current.amount]);
        await this.ledger(client, ownerId, current.amount, integer(updated.rows[0].available_credits), 'refund', jobId, reason);
      }
      await client.query("UPDATE processing_admissions SET status = 'refunded', updated_at = NOW() WHERE job_id = $1", [jobId]);
    });
  }

  async claimDue(now: string, owner: string, limit = 10): Promise<OutboxMessage[]> {
    const result = await this.pool.query<{ id: string; job_id: string; owner_id: string; action: 'process' | 'preflight'; state: string; attempts: number; execution_ref: string | null }>(`
      WITH due AS (
        SELECT id FROM processing_outbox
        WHERE state IN ('pending','dispatched') AND due_at <= $1 AND (lease_until IS NULL OR lease_until <= $1)
        ORDER BY due_at FOR UPDATE SKIP LOCKED LIMIT $3
      )
      UPDATE processing_outbox o SET lease_owner = $2, lease_until = $1::timestamptz + interval '60 seconds',
        attempts = attempts + CASE WHEN state = 'pending' THEN 1 ELSE 0 END, updated_at = NOW()
      FROM due WHERE o.id = due.id RETURNING o.*
    `, [now, owner, Math.max(1, Math.min(100, limit))]);
    return result.rows.map((r) => ({ id: r.id, jobId: r.job_id, ownerId: r.owner_id, action: r.action === 'preflight' ? 'preflight' : r.state === 'dispatched' ? 'reconcile' : 'process', attempts: r.attempts, ...(r.execution_ref ? { executionRef: r.execution_ref } : {}) }));
  }
  async recordDispatch(id: string, owner: string, nextCheckAt: string, executionRef?: string): Promise<void> {
    await this.pool.query("UPDATE processing_outbox SET state = 'dispatched', due_at = $3, execution_ref = COALESCE($4, execution_ref), lease_owner = NULL, lease_until = NULL, updated_at = NOW() WHERE id = $1 AND lease_owner = $2 AND state NOT IN ('completed','dead')", [id, owner, nextCheckAt, executionRef ?? null]);
  }
  async retryDispatch(id: string, owner: string, nextCheckAt: string, error: string): Promise<void> {
    await this.pool.query("UPDATE processing_outbox SET state = 'pending', due_at = $3, last_error = $4, lease_owner = NULL, lease_until = NULL, updated_at = NOW() WHERE id = $1 AND lease_owner = $2 AND state NOT IN ('completed','dead')", [id, owner, nextCheckAt, error.replace(/https?:\/\/\S+/g, '[redacted-url]').slice(0, 240)]);
  }
  async completeOutbox(jobId: string): Promise<void> { await this.pool.query("UPDATE processing_outbox SET state = 'completed', lease_owner = NULL, lease_until = NULL, updated_at = NOW() WHERE job_id = $1", [jobId]); }

  private async enqueue(client: Pick<PoolClient, 'query'>, ownerId: string, jobId: string, action: 'process' | 'preflight', now: string): Promise<void> {
    await client.query("INSERT INTO processing_outbox (id, job_id, owner_id, action, due_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (job_id, action) DO NOTHING", [randomUUID(), jobId, ownerId, action, now]);
  }
  private async lockAdmission(client: PoolClient, jobId: string, ownerId: string): Promise<Admission> {
    const result = await client.query<AdmissionRow>('SELECT * FROM processing_admissions WHERE job_id = $1 FOR UPDATE', [jobId]);
    if (!result.rows[0] || result.rows[0].owner_id !== ownerId) throw new ProcessingError('admission_missing', 'Financial operation not found', 404);
    return admission(result.rows[0]);
  }
  private async ensureAccount(client: PoolClient, ownerId: string): Promise<void> { await client.query('INSERT INTO processing_accounts (owner_id) VALUES ($1) ON CONFLICT (owner_id) DO NOTHING', [ownerId]); }
  private async ensureFree(client: PoolClient, ownerId: string): Promise<void> {
    const inserted = await client.query('INSERT INTO user_benefits (user_id, balance) VALUES ($1, 1) ON CONFLICT (user_id) DO NOTHING RETURNING user_id', [ownerId]);
    if (inserted.rows[0]) await client.query("INSERT INTO benefit_ledger (user_id, delta, balance_after, reason, reference_id) VALUES ($1, 1, 1, 'first_use', $1)", [ownerId]);
  }
  private async lockBalance(client: PoolClient, ownerId: string, unit: CreditUnit): Promise<number> {
    if (unit === 'freeUses') {
      const result = await client.query<{ balance: number }>('SELECT balance FROM user_benefits WHERE user_id = $1 FOR UPDATE', [ownerId]);
      return result.rows[0] ? integer(result.rows[0].balance) : 0;
    }
    const result = await client.query<{ available_credits: string }>('SELECT available_credits FROM processing_accounts WHERE owner_id = $1 FOR UPDATE', [ownerId]);
    return result.rows[0] ? integer(result.rows[0].available_credits) : 0;
  }
  private async ledger(client: PoolClient, ownerId: string, delta: number, balance: number, reason: string, reference: string, actor?: string): Promise<void> {
    await client.query('INSERT INTO processing_credit_ledger (owner_id, delta, balance_after, reason, reference_id, actor_id) VALUES ($1,$2,$3,$4,$5,$6)', [ownerId, delta, balance, reason, reference, actor ?? null]);
  }
  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const value = await work(client); await client.query('COMMIT'); return value; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}
