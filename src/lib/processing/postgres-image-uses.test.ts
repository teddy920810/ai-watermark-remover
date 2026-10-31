import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresPaymentStore } from '../payments/postgres-payment-store';
import { PostgresProcessingStore } from './postgres-processing-store';

// Real migrated SQL, serial transactions. This is not multi-connection PG lock testing.
const db = new PGlite();
let tail = Promise.resolve();
const pool = {
  query: (sql: string, params?: unknown[]) => db.query(sql, params),
  async connect() {
    const previous = tail;
    let release = () => {};
    tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    return { query: (sql: string, params?: unknown[]) => db.query(sql, params), release };
  },
} as unknown as Pool;
const finance = new PostgresProcessingStore(pool, { imageCreditsEnabled: true, paymentEnvironment: 'live' });
const payments = new PostgresPaymentStore(pool, 'live');
const request = { jobId: 'normal-image-1', ownerId: 'owner-1', idempotencyKey: 'normal-click-1', requestHash: 'sealed-quote', amount: 1, unit: 'purchasedImageCredits' as const, now: '2026-10-31T00:00:00.000Z' };
beforeAll(async () => {
  for (const name of (await readdir('db/migrations')).filter((file) => file.endsWith('.sql')).sort()) await db.exec(await readFile(`db/migrations/${name}`, 'utf8'));
}, 30_000);
beforeEach(async () => {
  await db.exec('TRUNCATE payment_orders,payment_events,payment_adjustments,user_benefits,processing_accounts,processing_admissions,processing_outbox CASCADE');
});
afterAll(async () => { await db.close(); });
async function purchase() {
  const order = await payments.createOrder('owner-1', { sku: 'starter', credits: 5, amountCents: 499, currency: 'USD', catalogVersion: 'test-approved' }, 'buy-1');
  await payments.attachPaypalOrder(order.id, 'PPORDER1');
  await payments.fulfill(order.id, { id: 'CAPTURE1', paypalOrderId: 'PPORDER1', amountCents: 499, currency: 'USD', merchantId: 'MERCHANT1' });
  await db.query("UPDATE user_benefits SET balance=0 WHERE user_id='owner-1'");
  await finance.grantCredits('owner-1', 77, 'admin-1', 'admin:operator');
  return order;
}
describe('normal-image purchased uses in the durable processing pipeline', () => {
  it('spends and settles one image use once, preserving administrator and free balances', async () => {
    await purchase();
    expect(await finance.getBalance('owner-1', 'purchasedImageCredits')).toBe(5);
    expect((await finance.reserveAndEnqueue(request)).created).toBe(true);
    expect((await finance.reserveAndEnqueue(request)).created).toBe(false);
    expect(await finance.settle(request.jobId, request.ownerId)).toBe('settled');
    expect(await finance.settle(request.jobId, request.ownerId)).toBe('settled');
    expect(await finance.getBalance('owner-1', 'purchasedImageCredits')).toBe(4);
    expect(await finance.getBalance('owner-1')).toBe(77);
    expect(await finance.getBalance('owner-1', 'freeUses')).toBe(0);
    expect((await db.query('SELECT * FROM processing_outbox')).rows).toHaveLength(1);
    expect((await db.query("SELECT * FROM paid_credit_ledger WHERE reason='job_reserve'")).rows).toHaveLength(1);
  });
  it('returns a failed operation to its original purchase without increasing processing credits', async () => {
    await purchase();
    await finance.reserveAndEnqueue(request);
    await finance.refund(request.jobId, request.ownerId, 'provider_failure');
    await finance.refund(request.jobId, request.ownerId, 'retry');
    expect(await finance.getBalance('owner-1', 'purchasedImageCredits')).toBe(5);
    expect(await finance.getBalance('owner-1')).toBe(77);
    expect((await db.query("SELECT * FROM paid_credit_ledger WHERE reason='job_refund'")).rows).toHaveLength(1);
  });
  it('never revives a refunded purchase when its in-flight image later fails', async () => {
    await purchase();
    await finance.reserveAndEnqueue(request);
    await payments.applyAdjustment('REFUND1', 'CAPTURE1', 'refund', 499);
    await finance.refund(request.jobId, request.ownerId, 'provider_failure');
    expect(await finance.getBalance('owner-1', 'purchasedImageCredits')).toBe(0);
    expect(await finance.getBalance('owner-1')).toBe(77);
    expect((await db.query<{ delta: number }>("SELECT delta FROM paid_credit_ledger WHERE reason='job_refund_frozen'")).rows).toEqual([{ delta: 0 }]);
    expect((await payments.getOrderByCaptureId('CAPTURE1'))?.status).toBe('review');
  });
  it('funds a variable image-credit cost without touching administrator credits', async () => {
    await purchase();
    await finance.reserveAndEnqueue({ ...request, amount: 3 });
    expect(await finance.getBalance('owner-1', 'purchasedImageCredits')).toBe(2);
    expect(await finance.getBalance('owner-1')).toBe(77);
    await finance.refund(request.jobId, request.ownerId, 'provider_failure');
    expect(await finance.getBalance('owner-1', 'purchasedImageCredits')).toBe(5);
  });
  it('rejects invalid amounts and cross-owner/disabled-wallet admission', async () => {
    await purchase();
    await expect(finance.reserveAndEnqueue({ ...request, amount: 0 })).rejects.toThrow();
    await expect(finance.reserveAndEnqueue({ ...request, ownerId: 'other-owner' })).rejects.toMatchObject({ code: 'insufficient_balance' });
    expect(await new PostgresProcessingStore(pool).getBalance('owner-1', 'purchasedImageCredits')).toBe(0);
    await expect(new PostgresProcessingStore(pool).reserveAndEnqueue(request)).rejects.toMatchObject({ code: 'image_credits_unavailable' });
    expect(await finance.getBalance('owner-1', 'purchasedImageCredits')).toBe(5);
  });
});
