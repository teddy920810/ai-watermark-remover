import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ensureFreeBenefitAccount } from './free-benefits';

// Real SQL on one connection; multi-connection Postgres locking remains a separate gate.
const db = new PGlite();
const calls: string[] = [];
const client = { query: async (sql: string, params?: unknown[]) => { calls.push(sql.trim()); return db.query(sql, params); } } as Pick<PoolClient, 'query'>;
beforeAll(async () => {
  for (const name of (await readdir('db/migrations')).filter(name => name.endsWith('.sql')).sort()) await db.exec(await readFile(`db/migrations/${name}`, 'utf8'));
}, 30_000);
beforeEach(async () => { await db.exec('TRUNCATE user_benefits CASCADE'); calls.length = 0; });
afterAll(async () => { await db.close(); });

describe('caller-owned free benefit transaction', () => {
  it('awards first use once across repeated callers without opening or closing their transaction', async () => {
    await db.exec('BEGIN');
    await ensureFreeBenefitAccount(client, 'owner');
    await ensureFreeBenefitAccount(client, 'owner');
    expect((await db.query('SELECT balance FROM user_benefits')).rows).toEqual([{ balance: 1 }]);
    expect((await db.query("SELECT delta,balance_after,reason,reference_id FROM benefit_ledger")).rows).toEqual([{ delta: 1, balance_after: 1, reason: 'first_use', reference_id: 'owner' }]);
    expect(calls.some(sql => /^(BEGIN|COMMIT|ROLLBACK)\b/.test(sql))).toBe(false);
    await db.exec('ROLLBACK');
    expect((await db.query('SELECT * FROM user_benefits')).rows).toEqual([]);
    expect((await db.query('SELECT * FROM benefit_ledger')).rows).toEqual([]);
  });
  it('does not update activity or identity on processing-only initialization', async () => {
    await ensureFreeBenefitAccount(client, 'owner');
    await db.exec("UPDATE user_benefits SET last_active_at='2000-01-01T00:00:00Z'");
    calls.length = 0;
    await ensureFreeBenefitAccount(client, 'owner');
    expect((await db.query<{ last_active_at: Date }>('SELECT last_active_at FROM user_benefits')).rows[0].last_active_at.toISOString()).toBe('2000-01-01T00:00:00.000Z');
    expect((await db.query('SELECT * FROM user_benefit_identities')).rows).toEqual([]);
    expect(calls.some(sql => /UPDATE user_benefits|user_benefit_identities/.test(sql))).toBe(false);
  });
  it('retains explicit activity and normalized identity updates without another first-use award', async () => {
    await ensureFreeBenefitAccount(client, 'owner');
    await db.exec("UPDATE user_benefits SET last_active_at='2000-01-01T00:00:00Z'");
    await ensureFreeBenefitAccount(client, 'owner', { touchActivity: true, email: ' Person@Example.test ' });
    expect((await db.query<{ last_active_at: Date }>('SELECT last_active_at FROM user_benefits')).rows[0].last_active_at.getUTCFullYear()).toBeGreaterThan(2000);
    expect((await db.query('SELECT user_id,email FROM user_benefit_identities')).rows).toEqual([{ user_id: 'owner', email: 'person@example.test' }]);
    expect((await db.query('SELECT * FROM benefit_ledger')).rows).toHaveLength(1);
  });
});
