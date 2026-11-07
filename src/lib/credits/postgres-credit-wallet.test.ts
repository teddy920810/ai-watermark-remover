import { PGlite } from '@electric-sql/pglite';
import type { Pool, PoolClient } from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresCreditWallet } from './postgres-credit-wallet';
import { PostgresProcessingStore } from '../processing/postgres-processing-store';
import { PostgresBenefitStore } from '../benefits/postgres-benefit-store';
import { PostgresPaymentStore } from '../payments/postgres-payment-store';

// Real SQL in memory, not a claim about multi-connection PostgreSQL contention.
const db = new PGlite();
let pending = Promise.resolve();
const pool = { query: (sql: string, values?: unknown[]) => db.query(sql, values), async connect() {
  const previous = pending; let release = () => {}; pending = new Promise<void>(resolve => { release = resolve; }); await previous;
  return { query: (sql: string, values?: unknown[]) => db.query(sql, values), release };
} } as unknown as Pool;
const wallet = new PostgresCreditWallet(pool, 'live', () => new Date('2026-11-04T23:59:59Z'));
async function transaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const value = await work(client); await client.query('COMMIT'); return value; }
  catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
beforeAll(async () => { for (const file of (await readdir('db/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await readFile(`db/migrations/${file}`, 'utf8')); }, 30_000);
beforeEach(async () => { await db.exec('TRUNCATE processing_outbox,user_benefits,processing_accounts,processing_admissions,payment_orders,payment_events,payment_adjustments CASCADE'); });
afterAll(async () => { await db.close(); });

describe('one source-aware Credits wallet', () => {
  it('never exposes or restores a new-currency admission through another environment', async () => {
    await wallet.bootstrap('owner', undefined, true);
    const finance = new PostgresProcessingStore(pool, { credits: { admissionEnabled: true, environment: 'live' } });
    await finance.reserveAndEnqueue({ ownerId: 'owner', jobId: 'live-only', idempotencyKey: 'live-only', requestHash: 'sealed', amount: 100,
      unit: 'credits', environment: 'live', walletEpoch: 1, now: '2026-11-04T00:00:00Z' });
    const other = new PostgresProcessingStore(pool, { credits: { admissionEnabled: false, environment: 'sandbox' } });
    await expect(other.getAdmission('live-only')).rejects.toMatchObject({ code: 'admission_missing' });
    await expect(other.findAdmission('owner', 'live-only')).rejects.toMatchObject({ code: 'admission_missing' });
    expect((await other.listAdmissionsForOwner('owner')).admissions).toHaveLength(0);
    expect(await new PostgresProcessingStore(pool, { credits: { admissionEnabled: false, environment: 'live' } }).getAdmission('live-only')).toMatchObject({ amount: 100, walletEpoch: 1 });
  });
  it('fulfills original orders into the unified purchase source once and freezes only that source', async () => {
    await wallet.bootstrap('owner', undefined, true);
    const payments = new PostgresPaymentStore(pool, 'live');
    const order = await payments.createOrder('owner', { sku: 'original', credits: 200, amountCents: 499, currency: 'USD', catalogVersion: 'original' }, 'purchase');
    await payments.attachPaypalOrder(order.id, 'PAYPAL1');
    const capture = { id: 'CAPTURE1', paypalOrderId: 'PAYPAL1', amountCents: 499, currency: 'USD' as const, merchantId: 'MERCHANT1' };
    await payments.fulfill(order.id, capture); await payments.fulfill(order.id, capture);
    expect(await wallet.summary('owner')).toMatchObject({ credits: 300 });
    expect((await db.query('SELECT * FROM paid_credit_lots')).rows).toHaveLength(0);
    await transaction(client => wallet.reserve(client, { ownerId: 'owner', jobId: 'used-order', amount: 110, walletEpoch: 1 }));
    await transaction(client => wallet.settle(client, 'used-order', 'owner'));
    await payments.applyAdjustment('refund', capture.id, 'refund', 499);
    expect(await payments.getOrder(order.id)).toMatchObject({ status: 'review' });
    expect(await wallet.summary('owner')).toMatchObject({ credits: 0 });
  });
  it('routes signup and check-in through the same new-currency reward contract', async () => {
    const benefits = new PostgresBenefitStore(pool, true, 'live', {}, undefined, { admissionEnabled: true, environment: 'live' });
    expect(await benefits.getSummary('new-user')).toMatchObject({ walletMode: 'unified', unit: 'credits', credits: 100 });
    expect(await benefits.checkIn('new-user')).toMatchObject({ walletMode: 'unified', credits: 200, rewardGranted: 100 });
    expect(await benefits.checkIn('new-user')).toMatchObject({ credits: 200, rewardGranted: 0 });
    expect((await benefits.getSummary('new-user'))).not.toHaveProperty('balance');
    await expect(benefits.reserve('old-client', 'new-user')).rejects.toMatchObject({ code: 'wallet_upgraded' });
  });
  it('admits, dispatches and settles the same currency atomically without touching legacy processing balance', async () => {
    await wallet.bootstrap('owner', undefined, true);
    const finance = new PostgresProcessingStore(pool, { credits: { admissionEnabled: true, environment: 'live' } });
    const request = { ownerId: 'owner', jobId: 'admitted', idempotencyKey: 'once', requestHash: 'sealed', amount: 100, unit: 'credits' as const,
      environment: 'live' as const, walletEpoch: 1, now: '2026-11-04T00:00:00Z' };
    expect(await finance.reserveAndEnqueue(request)).toMatchObject({ created: true, admission: { unit: 'credits', amount: 100 } });
    expect(await finance.reserveAndEnqueue({ ...request, jobId: 'lost-response-retry' })).toMatchObject({ created: false, admission: { jobId: 'admitted' } });
    expect(await finance.getBalance('owner', 'credits')).toBe(0);
    expect(await finance.getBalance('owner', 'processingCredits')).toBe(0);
    expect((await db.query('SELECT * FROM processing_outbox')).rows).toHaveLength(1);
    await finance.refund('admitted', 'owner', 'failed');
    await finance.refund('admitted', 'owner', 'failed');
    expect(await finance.settle('admitted', 'owner')).toBe('refunded');
    expect(await finance.getBalance('owner', 'credits')).toBe(100);
  });
  it('enforces the default-off admission and legacy cutover fence inside the financial transaction', async () => {
    await wallet.bootstrap('owner', undefined, true);
    const finance = new PostgresProcessingStore(pool, { credits: { admissionEnabled: false, environment: 'live' } });
    const request = { ownerId: 'owner', jobId: 'blocked', idempotencyKey: 'blocked', requestHash: 'sealed', amount: 100, unit: 'credits' as const,
      environment: 'live' as const, walletEpoch: 1, now: '2026-11-04T00:00:00Z' };
    await expect(finance.reserveAndEnqueue(request)).rejects.toMatchObject({ code: 'credits_admission_closed' });
    await expect(finance.reserveAndEnqueue({ ...request, unit: 'freeUses', amount: 1 })).rejects.toMatchObject({ code: 'wallet_upgraded' });
    expect((await db.query('SELECT * FROM processing_admissions')).rows).toHaveLength(0);
    expect(await wallet.summary('owner')).toMatchObject({ credits: 100 });
  });
  it('issues the first reward once and uses the same currency for all sources', async () => {
    expect(await wallet.bootstrap('owner', undefined, true)).toMatchObject({ phase: 'unified', credits: 100 });
    expect(await wallet.bootstrap('owner', undefined, true)).toMatchObject({ credits: 100 });
    await wallet.grant('owner', { amount: 300, reference: 'grant-1', actor: 'admin:qa' });
    expect(await wallet.summary('owner')).toMatchObject({ credits: 400, rewardAvailable: 100, rewardReserved: 0 });
    const reserved = await transaction(client => wallet.reserve(client, { ownerId: 'owner', jobId: 'mixed', amount: 300, walletEpoch: 1 }));
    expect(reserved).toBe('reserved');
    expect(await wallet.summary('owner')).toMatchObject({ credits: 100, rewardAvailable: 0, rewardReserved: 100 });
    expect((await db.query('SELECT amount::text AS amount FROM credit_allocations WHERE job_id=$1 ORDER BY amount', ['mixed'])).rows).toEqual([{ amount: '100' }, { amount: '200' }]);
    await transaction(client => wallet.settle(client, 'mixed', 'owner'));
    await transaction(client => wallet.settle(client, 'mixed', 'owner'));
    expect(await wallet.summary('owner')).toMatchObject({ credits: 100, rewardReserved: 0 });
  });
  it('does not partially debit on shortfall and refunds the original allocation exactly once', async () => {
    await wallet.bootstrap('owner', undefined, true);
    await expect(transaction(client => wallet.reserve(client, { ownerId: 'owner', jobId: 'too-much', amount: 101, walletEpoch: 1 }))).rejects.toMatchObject({ code: 'insufficient_balance' });
    expect(await wallet.summary('owner')).toMatchObject({ credits: 100 });
    expect((await db.query('SELECT * FROM credit_reservations')).rows).toHaveLength(0);
    await transaction(client => wallet.reserve(client, { ownerId: 'owner', jobId: 'refund', amount: 100, walletEpoch: 1 }));
    await transaction(client => wallet.refund(client, 'refund', 'owner'));
    await transaction(client => wallet.refund(client, 'refund', 'owner'));
    expect(await transaction(client => wallet.settle(client, 'refund', 'owner'))).toBe('refunded');
    expect(await wallet.summary('owner')).toMatchObject({ credits: 100 });
  });
  it('caps only reward available plus held, and fills the remaining space exactly', async () => {
    await wallet.bootstrap('owner', undefined, true);
    await wallet.grant('owner', { amount: 900, reference: 'admin', actor: 'admin:qa' });
    expect(await wallet.checkIn('owner')).toMatchObject({ credits: 1100, granted: 100 });
    expect(await wallet.checkIn('owner')).toMatchObject({ credits: 1100, granted: 0 });
    await db.query("UPDATE credit_lots SET granted=granted+50,available=available+50 WHERE kind='reward' AND source_id='first'");
    const nextDay = new PostgresCreditWallet(pool, 'live', () => new Date('2026-11-05T00:00:00Z'));
    expect(await nextDay.checkIn('owner')).toMatchObject({ credits: 1200, rewardAvailable: 300, granted: 50 });
    await transaction(client => wallet.reserve(client, { ownerId: 'owner', jobId: 'held', amount: 100, walletEpoch: 1 }));
    const thirdDay = new PostgresCreditWallet(pool, 'live', () => new Date('2026-11-06T00:00:00Z'));
    expect(await thirdDay.checkIn('owner')).toMatchObject({ granted: 0, rewardAvailable: 200, rewardReserved: 100 });
    await transaction(client => wallet.refund(client, 'held', 'owner'));
    expect(await wallet.summary('owner')).toMatchObject({ rewardAvailable: 300 });
  });
  it('revokes only the named original grant and preserves idempotency even after it is exhausted', async () => {
    await wallet.bootstrap('owner', undefined, true);
    await wallet.grant('owner', { amount: 50, reference: 'one', actor: 'admin:qa' });
    await wallet.grant('owner', { amount: 300, reference: 'two', actor: 'admin:qa' });
    await expect(wallet.revoke('owner', { amount: 51, grantReference: 'one', reference: 'bad', actor: 'admin:qa' })).rejects.toMatchObject({ code: 'source_insufficient' });
    expect(await wallet.revoke('owner', { amount: 50, grantReference: 'one', reference: 'revoke', actor: 'admin:qa' })).toMatchObject({ changed: true, balance: 400 });
    expect(await wallet.revoke('owner', { amount: 50, grantReference: 'one', reference: 'revoke', actor: 'admin:qa' })).toMatchObject({ changed: false, balance: 400 });
    await expect(wallet.revoke('owner', { amount: 50, grantReference: 'two', reference: 'revoke', actor: 'admin:qa' })).rejects.toMatchObject({ code: 'adjustment_conflict' });
    await expect(new PostgresCreditWallet(pool, 'sandbox').revoke('owner', { amount: 1, grantReference: 'two', reference: 'cross-env', actor: 'admin:qa' })).rejects.toThrow();
  });
  it('never silently changes legacy or draining accounts into the new wallet', async () => {
    expect(await wallet.bootstrap('legacy', undefined, false)).toMatchObject({ phase: 'legacy' });
    expect(await wallet.bootstrap('legacy', undefined, true)).toMatchObject({ phase: 'legacy' });
    await expect(wallet.grant('legacy', { amount: 1, reference: 'unapproved', actor: 'admin:qa' })).rejects.toMatchObject({ code: 'wallet_not_unified' });
    await wallet.bootstrap('owner', undefined, true);
    await db.query("UPDATE credit_accounts SET phase='draining' WHERE owner_id='owner'");
    await expect(transaction(client => wallet.reserve(client, { ownerId: 'owner', jobId: 'blocked', amount: 1, walletEpoch: 1 }))).rejects.toMatchObject({ code: 'wallet_not_unified' });
  });
  it('does not restore a frozen purchase allocation when a mixed-source task fails', async () => {
    await wallet.bootstrap('owner', undefined, true);
    await transaction(client => wallet.purchase(client, { id: 'original-order', user_id: 'owner', environment: 'live', credits: 200 }));
    await transaction(client => wallet.reserve(client, { ownerId: 'owner', jobId: 'mixed-failed', amount: 300, walletEpoch: 1 }));
    expect(await transaction(client => wallet.freezePurchase(client, 'owner', 'original-order'))).toEqual({ found: true, used: true });
    await transaction(client => wallet.refund(client, 'mixed-failed', 'owner'));
    expect(await wallet.summary('owner')).toMatchObject({ credits: 100 });
    expect((await db.query("SELECT delta::text AS delta FROM credit_ledger WHERE reason='refund_frozen'")).rows).toEqual([{ delta: '0' }]);
  });
  it('rolls back every lot debit when a later allocation write fails', async () => {
    await wallet.bootstrap('owner', undefined, true);
    await expect(transaction(client => wallet.reserve({ query: (sql: string, values?: unknown[]) => {
      if (sql.includes('INSERT INTO credit_allocations')) throw new Error('injected allocation failure');
      return client.query(sql, values);
    } } as PoolClient, { ownerId: 'owner', jobId: 'rollback', amount: 100, walletEpoch: 1 }))).rejects.toThrow('injected allocation failure');
    expect(await wallet.summary('owner')).toMatchObject({ credits: 100 });
    expect((await db.query('SELECT * FROM credit_reservations')).rows).toHaveLength(0);
  });
  it('cannot revoke a consumed or held grant from another grant or the reward balance', async () => {
    await wallet.bootstrap('owner', undefined, true);
    await wallet.grant('owner', { amount: 100, reference: 'original', actor: 'admin:qa' });
    await transaction(client => wallet.reserve(client, { ownerId: 'owner', jobId: 'occupied', amount: 200, walletEpoch: 1 }));
    await wallet.grant('owner', { amount: 500, reference: 'unrelated', actor: 'admin:qa' });
    await expect(wallet.revoke('owner', { amount: 1, grantReference: 'original', reference: 'held-revoke', actor: 'admin:qa' })).rejects.toMatchObject({ code: 'source_insufficient' });
    await transaction(client => wallet.settle(client, 'occupied', 'owner'));
    await expect(wallet.revoke('owner', { amount: 1, grantReference: 'original', reference: 'used-revoke', actor: 'admin:qa' })).rejects.toMatchObject({ code: 'source_insufficient' });
    expect(await wallet.summary('owner')).toMatchObject({ credits: 500 });
  });
});
