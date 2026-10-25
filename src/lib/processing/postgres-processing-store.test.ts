import { readFileSync } from 'node:fs';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { PostgresProcessingStore } from './postgres-processing-store';
import { NOW } from './test-fixtures';

const request = { jobId: 'job-1', ownerId: 'user-1', idempotencyKey: 'click-1', requestHash: 'hash', amount: 3, unit: 'processingCredits' as const, now: NOW };
function fakePool(options: { balance?: number; freeBalance?: number; existing?: Record<string, unknown>; admission?: Record<string, unknown>; grantExists?: boolean; grantAmount?: number; grantActor?: string; revokeExists?: boolean; revokeAmount?: number; revokeActor?: string; failOutbox?: boolean } = {}) {
  let balance = options.balance ?? 10; let freeBalance = options.freeBalance ?? 3;
  const query = vi.fn(async (text: string, values: unknown[] = []) => {
    const sql = text.replace(/\s+/g, ' ').trim();
    if (options.failOutbox && sql.startsWith('INSERT INTO processing_outbox')) throw new Error('Database write failed');
    if (sql.startsWith('SELECT') && sql.includes('FROM processing_accounts')) return { rows: [{ available_credits: balance }] };
    if (sql.startsWith('SELECT') && sql.includes('FROM user_benefits')) return { rows: [{ balance: freeBalance }] };
    if (sql.startsWith('SELECT') && sql.includes('FROM processing_admissions')) return { rows: options.admission ? [options.admission] : options.existing ? [options.existing] : [] };
    if (sql.startsWith('SELECT') && sql.includes('FROM processing_credit_ledger')) return { rows: sql.includes("reason = 'revoke'") ? options.revokeExists ? [{ delta: String(-(options.revokeAmount ?? 30)), actor_id: options.revokeActor ?? 'admin-1' }] : [] : options.grantExists ? [{ id: 1, delta: String(options.grantAmount ?? 20), actor_id: options.grantActor ?? 'admin-1' }] : [] };
    if (sql.startsWith('UPDATE processing_accounts') && sql.includes('available_credits = available_credits -')) { balance -= Number(values[1]); return { rows: [{ available_credits: balance }] }; }
    if (sql.startsWith('UPDATE processing_accounts') && sql.includes('available_credits = available_credits +')) { balance += Number(values[1]); return { rows: [{ available_credits: balance }] }; }
    if (sql.startsWith('UPDATE user_benefits') && sql.includes('balance = balance - 1')) { freeBalance--; return { rows: [{ balance: freeBalance }] }; }
    if (sql.startsWith('UPDATE user_benefits') && sql.includes('balance = balance + 1')) { freeBalance++; return { rows: [{ balance: freeBalance }] }; }
    return { rows: [], rowCount: 1 };
  });
  const release = vi.fn(); const pool = { query, connect: vi.fn().mockResolvedValue({ query, release }) } as unknown as Pool;
  return { pool, query, release };
}
const admission = { job_id: 'job-1', owner_id: 'user-1', operation_key: 'click-1', request_hash: 'hash', amount: '3', unit: 'processingCredits', status: 'reserved' };

describe('PostgresProcessingStore', () => {
  it('pages admitted history by owner and stable newest-first keys while preserving cursor timestamp precision', async () => {
    const f = fakePool(); const store = new PostgresProcessingStore(f.pool);
    const rows = [
      { ...admission, job_id: 'job-c', cursor_created_at: '2026-10-24 00:00:00.123456+00' },
      { ...admission, job_id: 'job-b', cursor_created_at: '2026-10-24 00:00:00.123455+00' },
      { ...admission, job_id: 'job-a', cursor_created_at: '2026-10-24 00:00:00.123455+00' },
    ];
    f.query.mockResolvedValueOnce({ rows });
    const page = await store.listAdmissionsForOwner('user-1', 2);
    expect(page.admissions.map((entry) => entry.jobId)).toEqual(['job-c', 'job-b']);
    expect(page.nextCursor).toEqual({ createdAt: '2026-10-24 00:00:00.123455+00', jobId: 'job-b' });
    const [sql, values] = f.query.mock.calls[0];
    expect(sql).toContain('created_at::text AS cursor_created_at'); expect(sql).toMatch(/WHERE owner_id = \$1/);
    expect(sql).toMatch(/ORDER BY created_at DESC, job_id DESC/); expect(values).toEqual(['user-1', null, null, 3]);
    f.query.mockResolvedValueOnce({ rows: [rows[2]] });
    expect(await store.listAdmissionsForOwner('user-1', 2, page.nextCursor)).toEqual({ admissions: [expect.objectContaining({ jobId: 'job-a', ownerId: 'user-1' })] });
    expect(f.query.mock.calls[1][0]).toMatch(/\(created_at, job_id\) < \(\$2::timestamptz, \$3::text\)/);
    expect(f.query.mock.calls[1][1]).toEqual(['user-1', '2026-10-24 00:00:00.123455+00', 'job-b', 3]);
  });
  it('bounds each admitted history query and reports exhaustion without an extra cursor', async () => {
    const f = fakePool(); const store = new PostgresProcessingStore(f.pool);
    expect(await store.listAdmissionsForOwner('other', 10_000)).toEqual({ admissions: [] });
    expect(f.query.mock.calls[0][1]).toEqual(['other', null, null, 101]);
    expect(f.query.mock.calls[0][0]).toMatch(/LIMIT \$4/); expect(f.pool.connect).not.toHaveBeenCalled();
  });
  it('revokes unused allocated processing credits atomically with a negative auditable ledger row', async () => {
    const f = fakePool({ balance: 30 }); const store = new PostgresProcessingStore(f.pool);
    expect(await store.revokeCredits('user-1', 30, 'revoke-wrong-owner-2026', 'admin-1')).toEqual({ revoked: true, balance: 0 });
    expect(f.query.mock.calls[0]).toEqual(['BEGIN']); expect(f.query).toHaveBeenLastCalledWith('COMMIT');
    expect(f.query.mock.calls).toContainEqual([expect.stringContaining('INSERT INTO processing_credit_ledger'), ['user-1', -30, 0, 'revoke', 'revoke-wrong-owner-2026', 'admin-1']]);
    expect(f.query.mock.calls.some(([sql]) => sql.includes('DELETE') || sql.includes('user_benefits') || sql.includes('processing_admissions'))).toBe(false);
  });
  it('returns an identical revoke retry before checking the depleted available balance', async () => {
    const f = fakePool({ balance: 0, revokeExists: true });
    expect(await new PostgresProcessingStore(f.pool).revokeCredits('user-1', 30, 'revoke-qa', 'admin-1')).toEqual({ revoked: false, balance: 0 });
    expect(f.query.mock.calls.some(([sql]) => sql.includes('UPDATE processing_accounts') || sql.includes('INSERT INTO processing_credit_ledger'))).toBe(false);
  });
  it('rejects insufficient revoke balance and conflicts without changing allocations', async () => {
    for (const scenario of [{ balance: 29, code: 'insufficient_balance' }, { balance: 0, revokeExists: true, revokeAmount: 29, code: 'revoke_conflict' }, { balance: 0, revokeExists: true, revokeActor: 'other-admin', code: 'revoke_conflict' }]) {
      const f = fakePool(scenario);
      await expect(new PostgresProcessingStore(f.pool).revokeCredits('user-1', 30, 'revoke-qa', 'admin-1')).rejects.toMatchObject({ code: scenario.code, status: 409 });
      expect(f.query).toHaveBeenLastCalledWith('ROLLBACK'); expect(f.query.mock.calls.some(([sql]) => sql.includes('UPDATE processing_accounts'))).toBe(false);
    }
  });
  it('rejects invalid administrator revokes before opening the database', async () => {
    const f = fakePool(); const store = new PostgresProcessingStore(f.pool);
    for (const amount of [0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) await expect(store.revokeCredits('user-1', amount, 'revoke-qa', 'admin')).rejects.toMatchObject({ code: 'invalid_revoke' });
    await expect(store.revokeCredits('user-1', 1, 'revoke-qa', ' ')).rejects.toMatchObject({ code: 'invalid_revoke' }); expect(f.pool.connect).not.toHaveBeenCalled();
  });
  it('reserves a variable amount and outbox in one transaction without touching free-use balances', async () => {
    const f = fakePool(); const result = await new PostgresProcessingStore(f.pool).reserveAndEnqueue(request);
    expect(result).toMatchObject({ created: true, admission: { amount: 3, unit: 'processingCredits' } });
    const sql = f.query.mock.calls.map(([q]) => q);
    expect(sql[0]).toBe('BEGIN'); expect(sql.at(-1)).toBe('COMMIT');
    expect(sql.some((q) => q.includes('FOR UPDATE'))).toBe(true);
    expect(sql.some((q) => q.includes('INSERT INTO processing_outbox'))).toBe(true);
    expect(sql.some((q) => q.includes('UPDATE user_benefits'))).toBe(false);
  });
  it('returns existing admission without another debit and rejects changed reuse', async () => {
    const f = fakePool({ existing: admission }); const store = new PostgresProcessingStore(f.pool);
    expect((await store.reserveAndEnqueue(request)).created).toBe(false);
    await expect(store.reserveAndEnqueue({ ...request, requestHash: 'different' })).rejects.toMatchObject({ code: 'idempotency_conflict' });
    expect(f.query.mock.calls.some(([q]) => q.includes('available_credits = available_credits -'))).toBe(false);
  });
  it('rolls back reservation when the durable outbox cannot be written', async () => {
    const f = fakePool({ failOutbox: true });
    await expect(new PostgresProcessingStore(f.pool).reserveAndEnqueue(request)).rejects.toThrow('Database write failed');
    expect(f.query).toHaveBeenLastCalledWith('ROLLBACK'); expect(f.release).toHaveBeenCalled();
  });
  it('rejects insufficient processing credits and never initializes them with a grant', async () => {
    const f = fakePool({ balance: 0 }); const store = new PostgresProcessingStore(f.pool);
    expect(await store.getBalance('user-1')).toBe(0);
    await expect(store.reserveAndEnqueue(request)).rejects.toMatchObject({ code: 'insufficient_balance' });
    expect(f.query.mock.calls.some(([q]) => q.includes("'grant'"))).toBe(false);
  });
  it('audits administrator grants and is idempotent by reference', async () => {
    const f = fakePool(); const store = new PostgresProcessingStore(f.pool);
    expect(await store.grantCredits('user-1', 20, 'qa-2026-10-24', 'admin-1')).toMatchObject({ balance: 30, granted: true });
    expect(f.query.mock.calls).toContainEqual([expect.stringContaining('INSERT INTO processing_credit_ledger'), expect.arrayContaining(['admin-1', 'qa-2026-10-24'])]);
    const existing = fakePool({ grantExists: true }); expect(await new PostgresProcessingStore(existing.pool).grantCredits('user-1', 20, 'qa-2026-10-24', 'admin-1')).toMatchObject({ granted: false });
    await expect(store.grantCredits('user-1', 0, 'ref', 'admin')).rejects.toMatchObject({ code: 'invalid_grant' });
  });
  it('rejects reuse of a grant reference with a different amount or audit actor before writing credits', async () => {
    for (const changed of [{ grantAmount: 21 }, { grantActor: 'other-admin' }]) {
      const f = fakePool({ grantExists: true, ...changed });
      await expect(new PostgresProcessingStore(f.pool).grantCredits('user-1', 20, 'qa-2026-10-24', 'admin-1')).rejects.toMatchObject({ code: 'grant_conflict', status: 409 });
      expect(f.query.mock.calls.some(([sql]) => sql.includes('UPDATE processing_accounts'))).toBe(false); expect(f.query).toHaveBeenLastCalledWith('ROLLBACK');
    }
  });
  it('rejects a blank audit actor before opening an administrator transaction', async () => {
    const f = fakePool(); await expect(new PostgresProcessingStore(f.pool).grantCredits('user-1', 20, 'qa', '   ')).rejects.toMatchObject({ code: 'invalid_grant' }); expect(f.pool.connect).not.toHaveBeenCalled();
  });
  it('keeps preflight delivery durable without any financial reservation', async () => {
    const f = fakePool(); await new PostgresProcessingStore(f.pool).enqueuePreflight('user-1', 'upload-1', NOW);
    expect(f.query.mock.calls.some(([q]) => q.includes('INSERT INTO processing_outbox'))).toBe(true);
    expect(f.query.mock.calls.some(([q]) => q.includes('processing_admissions') || q.includes('UPDATE processing_accounts'))).toBe(false);
  });
  it('reserves a free normal image in legacy reservations so check-in keeps counting active uses', async () => {
    const f = fakePool(); await new PostgresProcessingStore(f.pool).reserveAndEnqueue({ ...request, amount: 1, unit: 'freeUses' });
    expect(f.query.mock.calls.some(([q]) => q.includes('INSERT INTO job_credit_reservations'))).toBe(true);
    expect(f.query.mock.calls.some(([q]) => q.includes('balance = balance - 1'))).toBe(true);
    expect(f.query.mock.calls.some(([q]) => q.includes('available_credits = available_credits -'))).toBe(false);
  });
  it('restores a reserved free use even at the reward cap, keeping a +1 legacy ledger entry', async () => {
    const f = fakePool({ freeBalance: 3, admission: { ...admission, amount: '1', unit: 'freeUses' } });
    await new PostgresProcessingStore(f.pool).refund('job-1', 'user-1', 'unknown_timeout');
    expect(f.query.mock.calls.some(([q]) => q.includes('balance = balance + 1'))).toBe(true);
    expect(f.query.mock.calls.some(([q]) => q.includes("'job_refund'"))).toBe(true);
  });
  it('does not settle or debit an already refunded late result', async () => {
    const f = fakePool({ admission: { ...admission, status: 'refunded' } });
    expect(await new PostgresProcessingStore(f.pool).settle('job-1', 'user-1')).toBe('refunded');
    expect(f.query.mock.calls.some(([q]) => q.includes('UPDATE processing_accounts'))).toBe(false);
  });
  it('keeps dispatch acknowledgments recoverable rather than completing accepted executions', async () => {
    const f = fakePool(); const store = new PostgresProcessingStore(f.pool);
    await store.claimDue(NOW, 'dispatcher', 5); await store.recordDispatch('o-1', 'dispatcher', NOW, 'execution-1');
    await store.retryDispatch('o-1', 'dispatcher', NOW, 'dispatch_unavailable'); await store.completeOutbox('job-1');
    expect(f.query.mock.calls.some(([q]) => q.includes('SKIP LOCKED'))).toBe(true);
    expect(f.query.mock.calls.some(([q]) => q.includes("state = 'dispatched'"))).toBe(true);
    expect(f.query.mock.calls.some(([q]) => q.includes("state = 'completed'"))).toBe(true);
  });
  it('retains retryable dispatches as pending instead of abandoning charged recovery after ten attempts', async () => {
    const f = fakePool(); await new PostgresProcessingStore(f.pool).retryDispatch('outbox', 'dispatcher', NOW, 'dispatch_unavailable');
    const statement = f.query.mock.calls[0][0]; expect(statement).toContain("state = 'pending'"); expect(statement).not.toContain("THEN 'dead'");
    expect(statement).toContain("state NOT IN ('completed','dead')"); expect(statement).toContain('lease_owner = NULL');
  });
});

describe('processing migration', () => {
  it('adds revocation through a new compatible migration while preserving the previous grant audit rules', () => {
    const sql = readFileSync(new URL('../../../db/migrations/006_processing_credit_revocations.sql', import.meta.url), 'utf8');
    expect(sql).toContain("'revoke'"); expect(sql).toContain("reason = 'revoke' AND delta < 0 AND actor_id IS NOT NULL");
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS processing_credit_ledger_reason_check');
    expect(sql).toContain("reason = 'grant' AND delta > 0 AND actor_id IS NOT NULL"); expect(sql).not.toMatch(/DELETE FROM|TRUNCATE|UPDATE processing_accounts/i);
  });
  it('adds separate zero-default credits and coordination without moving job state into SQL', () => {
    const sql = readFileSync(new URL('../../../db/migrations/005_processing_pipeline.sql', import.meta.url), 'utf8');
    expect(sql).toContain('available_credits BIGINT NOT NULL DEFAULT 0');
    expect(sql).toContain('UNIQUE (owner_id, operation_key)');
    expect(sql).toContain('CHECK (balance >= 0)'); expect(sql).toContain('CHECK (balance_after >= 0)');
    expect(sql).toContain("reason = 'grant' AND delta > 0 AND actor_id IS NOT NULL");
    expect(sql).not.toContain('provider_job_id'); expect(sql).not.toContain('result_key'); expect(sql).not.toContain('DROP TABLE');
  });
});
