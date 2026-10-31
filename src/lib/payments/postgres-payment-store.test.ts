import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresBenefitStore } from '../benefits/postgres-benefit-store';
import { PostgresPaymentStore } from './postgres-payment-store';
import { consumePurchasedImageCredit, getPurchasedImageBalance, refundPurchasedImageCredit, reservePurchasedImageCredit } from './image-credit-wallet';

// Real SQL, isolated in memory. PGlite serializes transactions; these tests do
// not claim real PostgreSQL multi-connection row/advisory-lock contention.
const db = new PGlite();
let queue = Promise.resolve();
const pool = {
  query: (sql: string, params?: unknown[]) => db.query(sql, params),
  async connect() {
    const previous = queue;
    let release = () => {};
    queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    return { query: (sql: string, params?: unknown[]) => db.query(sql, params), release };
  },
} as unknown as Pool;
const payments = new PostgresPaymentStore(pool, 'live');
const benefits = new PostgresBenefitStore(pool, true, 'live');
const purchase = { sku: 'starter', credits: 5, amountCents: 499, currency: 'USD' as const, catalogVersion: 'approved-v1' };
const capture = { id: 'CAPTURE1', paypalOrderId: 'PPORDER1', amountCents: 499, currency: 'USD' as const, merchantId: 'MERCHANT1' };
const imageReservation = (jobId: string, ownerId = 'owner-1', environment: 'live' | 'sandbox' = 'live') => ({ jobId, ownerId, environment });
async function bought() {
  const order = await payments.createOrder('owner-1', purchase, 'purchase-1');
  await payments.attachPaypalOrder(order.id, capture.paypalOrderId);
  return payments.fulfill(order.id, capture);
}
async function transaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
beforeAll(async () => {
  for (const name of (await readdir('db/migrations')).filter((file) => file.endsWith('.sql')).sort()) await db.exec(await readFile(`db/migrations/${name}`, 'utf8'));
}, 30_000);
beforeEach(async () => {
  await db.exec('TRUNCATE payment_orders, payment_events, payment_adjustments, user_benefits, processing_accounts, processing_admissions CASCADE');
});
afterAll(async () => { await db.close(); });

describe('PayPal image-use lots on the current production schema', () => {
  it('reuses one purchase request but rejects changed snapshots and invalid financial inputs', async () => {
    const first = await payments.createOrder('owner-1', purchase, 'same-request');
    expect((await payments.createOrder('owner-1', purchase, 'same-request')).id).toBe(first.id);
    for (const changed of [{ ...purchase, credits: 6 }, { ...purchase, amountCents: 500 }, { ...purchase, catalogVersion: 'other' }]) {
      await expect(payments.createOrder('owner-1', changed, 'same-request')).rejects.toThrow('another purchase');
    }
    for (const changed of [{ ...purchase, credits: 0 }, { ...purchase, amountCents: 1.5 }, { ...purchase, sku: '' }]) {
      await expect(payments.createOrder('owner-1', changed, 'invalid')).rejects.toThrow('Invalid payment purchase');
    }
    await expect(payments.createOrder('', purchase, 'missing-owner')).rejects.toThrow();
    await expect(payments.createOrder('owner-1', purchase, '')).rejects.toThrow();
    expect((await payments.createOrder('owner-2', purchase, 'same-request')).id).not.toBe(first.id);
  });

  it('keeps provider IDs uniquely bound and every order lookup/list scoped to the environment', async () => {
    const first = await bought();
    const second = await payments.createOrder('owner-2', purchase, 'second');
    await expect(payments.attachPaypalOrder(first.id, 'OTHERORDER')).rejects.toThrow('already assigned');
    await expect(payments.attachPaypalOrder(second.id, capture.paypalOrderId)).rejects.toThrow();
    await expect(payments.attachPaypalOrder(second.id, '')).rejects.toThrow();
    expect((await payments.getOrderByPaypalId(capture.paypalOrderId))?.userId).toBe('owner-1');
    expect((await payments.getOrderByCaptureId(capture.id))?.id).toBe(first.id);
    expect(await payments.getOrder('missing')).toBeNull();
    expect((await payments.listOrders('owner-2')).map((order) => order.id)).toEqual([second.id]);
    const sandbox = new PostgresPaymentStore(pool, 'sandbox');
    expect(await sandbox.getOrder(first.id)).toBeNull();
    expect(await sandbox.getOrderByPaypalId(capture.paypalOrderId)).toBeNull();
    expect(await sandbox.getOrderByCaptureId(capture.id)).toBeNull();
    expect(await sandbox.listOrders('owner-1')).toHaveLength(0);
    await expect(sandbox.fulfill(first.id, capture)).rejects.toThrow('not found');
  });

  it('rejects mismatched captures before any purchase entitlement is granted', async () => {
    const order = await payments.createOrder('owner-1', purchase, 'one');
    await payments.attachPaypalOrder(order.id, capture.paypalOrderId);
    for (const wrong of [{ ...capture, id: '' }, { ...capture, merchantId: '' }, { ...capture, amountCents: 1 }, { ...capture, paypalOrderId: 'OTHER' }]) {
      await expect(payments.fulfill(order.id, wrong)).rejects.toThrow('does not match');
    }
    expect((await payments.getOrder(order.id))?.status).toBe('created');
    expect((await benefits.getSummary('owner-1')).paidBalance).toBe(0);
    await payments.fulfill(order.id, capture);
    await expect(payments.fulfill(order.id, { ...capture, id: 'OTHER' })).rejects.toThrow('does not match');
  });

  it('grants the same capture once and leaves free uses and administrator processing credits separate', async () => {
    await db.query("INSERT INTO processing_accounts(owner_id,available_credits) VALUES ('owner-1',20)");
    const order = await bought();
    await Promise.all([payments.fulfill(order.id, capture), payments.fulfill(order.id, capture)]);
    expect(await benefits.getSummary('owner-1', 'person@example.com')).toMatchObject({ balance: 1, paidBalance: 5 });
    expect((await db.query('SELECT * FROM paid_credit_ledger WHERE reason=\'purchase\'')).rows).toHaveLength(1);
    expect((await db.query<{ available_credits: number }>('SELECT available_credits FROM processing_accounts')).rows[0].available_credits).toBe(20);
  });

  it('uses free first for legacy image tools, then a paid lot, with exact-source failure return', async () => {
    await bought();
    await benefits.reserve('free-job', 'owner-1');
    await benefits.consume('free-job', 'owner-1');
    await benefits.reserve('paid-job', 'owner-1');
    await benefits.reserve('paid-job', 'owner-1');
    expect(await benefits.getSummary('owner-1')).toMatchObject({ balance: 0, paidBalance: 4 });
    await benefits.refund('paid-job', 'owner-1');
    await benefits.refund('paid-job', 'owner-1');
    expect(await benefits.getSummary('owner-1')).toMatchObject({ balance: 0, paidBalance: 5 });
  });

  it('supports the current pipeline through the same transaction without touching processing credits', async () => {
    await bought();
    await transaction(async (client) => {
      expect(await reservePurchasedImageCredit(client, imageReservation('pipeline-job'))).toBe(true);
      expect(await reservePurchasedImageCredit(client, imageReservation('pipeline-job'))).toBe(true);
      expect(await getPurchasedImageBalance(client, 'owner-1', 'live')).toBe(4);
      await consumePurchasedImageCredit(client, imageReservation('pipeline-job'));
      await consumePurchasedImageCredit(client, imageReservation('pipeline-job'));
      await refundPurchasedImageCredit(client, imageReservation('pipeline-job'));
    });
    expect((await benefits.getSummary('owner-1')).paidBalance).toBe(4);
    expect((await db.query('SELECT * FROM processing_accounts')).rows).toHaveLength(0);
    expect((await db.query('SELECT * FROM paid_credit_ledger WHERE reason=\'job_reserve\'')).rows).toHaveLength(1);
  });

  it('freezes a refunded lot and does not resurrect paid uses on a late pipeline failure', async () => {
    const order = await bought();
    await transaction((client) => reservePurchasedImageCredit(client, imageReservation('pipeline-job')));
    await payments.applyAdjustment('refund:REFUND1', capture.id, 'refund', 499);
    await transaction(async (client) => {
      await refundPurchasedImageCredit(client, imageReservation('pipeline-job'));
      await refundPurchasedImageCredit(client, imageReservation('pipeline-job'));
    });
    expect((await benefits.getSummary('owner-1')).paidBalance).toBe(0);
    expect((await payments.getOrder(order.id))?.status).toBe('review');
    expect((await db.query<{ delta: number }>("SELECT delta FROM paid_credit_ledger WHERE reason='job_refund_frozen'")).rows).toEqual([{ delta: 0 }]);
  });

  it('marks a full unused refund terminal, but sends a partial refund to review and freezes the whole affected lot', async () => {
    const first = await bought();
    await payments.applyAdjustment('partial-1', capture.id, 'refund', 100);
    await payments.applyAdjustment('partial-1', capture.id, 'refund', 100);
    expect((await payments.getOrder(first.id))?.status).toBe('review');
    expect((await benefits.getSummary('owner-1')).paidBalance).toBe(0);
    const second = await payments.createOrder('owner-1', purchase, 'purchase-2');
    await payments.attachPaypalOrder(second.id, 'PPORDER2');
    await payments.fulfill(second.id, { ...capture, id: 'CAPTURE2', paypalOrderId: 'PPORDER2' });
    await payments.applyAdjustment('full-2', 'CAPTURE2', 'refund', 499);
    await payments.fulfill(second.id, { ...capture, id: 'CAPTURE2', paypalOrderId: 'PPORDER2' });
    expect((await payments.getOrder(second.id))?.status).toBe('refunded');
    expect((await benefits.getSummary('owner-1')).paidBalance).toBe(0);
    expect((await db.query("SELECT * FROM paid_credit_ledger WHERE reason='adjustment'")).rows).toHaveLength(2);
  });

  it('rejects cross-owner and cross-environment reservation access without changing a lot', async () => {
    await bought();
    await benefits.getSummary('owner-2');
    await transaction((client) => reservePurchasedImageCredit(client, imageReservation('pipeline-job')));
    for (const input of [imageReservation('pipeline-job', 'owner-2'), imageReservation('pipeline-job', 'owner-1', 'sandbox')]) {
      await expect(transaction((client) => reservePurchasedImageCredit(client, input))).rejects.toThrow();
      await expect(transaction((client) => consumePurchasedImageCredit(client, input))).rejects.toThrow();
      await expect(transaction((client) => refundPurchasedImageCredit(client, input))).rejects.toThrow();
    }
    expect((await benefits.getSummary('owner-1')).paidBalance).toBe(4);
    expect((await benefits.getSummary('owner-2')).paidBalance).toBe(0);
    await expect(transaction((client) => reservePurchasedImageCredit(client, imageReservation('new-sandbox', 'owner-1', 'sandbox')))).resolves.toBe(false);
  });

  it('records adjustments before fulfillment and never grants a reversed purchase', async () => {
    const order = await payments.createOrder('owner-1', purchase, 'early');
    await payments.attachPaypalOrder(order.id, capture.paypalOrderId);
    await payments.applyAdjustment('reversal:early', capture.id, 'reversal', 0);
    expect((await payments.fulfill(order.id, capture)).status).toBe('review');
    expect((await benefits.getSummary('owner-1')).paidBalance).toBe(0);
  });

  it('preserves current free-use restoration above the reward cap and ignores paid reservations for daily reward eligibility', async () => {
    await bought();
    await benefits.reserve('free-job', 'owner-1');
    for (let index = 0; index < 4; index += 1) await benefits.reserve(`paid-${index}`, 'owner-1');
    expect(await benefits.checkIn('owner-1')).toMatchObject({ balance: 1, granted: true, paidBalance: 1 });
    await db.query("UPDATE user_benefits SET balance=3 WHERE user_id='owner-1'");
    await benefits.refund('free-job', 'owner-1');
    expect(await benefits.getSummary('owner-1')).toMatchObject({ balance: 4, paidBalance: 1 });
  });

  it('keeps the financial inbox retryable until completed and rejects event identity conflicts', async () => {
    const event = { id: 'EVENT1', eventType: 'PAYMENT.CAPTURE.COMPLETED', resourceId: capture.id, payload: { resourceId: capture.id } };
    expect(await payments.recordEvent(event)).toBe(true);
    expect(await payments.recordEvent(event)).toBe(true);
    await payments.completeEvent(event.id);
    expect(await payments.recordEvent(event)).toBe(false);
    await expect(payments.recordEvent({ ...event, resourceId: 'OTHER' })).rejects.toThrow();
    expect(await new PostgresPaymentStore(pool, 'sandbox').recordEvent(event)).toBe(true);
    await expect(payments.recordEvent({ ...event, resourceId: '' })).rejects.toThrow('Invalid payment event');
    await expect(payments.recordEvent({ ...event, payload: { oversized: 'a'.repeat(16_385) } })).rejects.toThrow('Invalid payment event');
    await expect(payments.recordEvent({ ...event, eventType: 'OTHER' })).rejects.toThrow('Conflicting');
  });

  it('limits new orders per owner while allowing idempotent retries', async () => {
    const first = await payments.createOrder('owner-1', purchase, 'first');
    for (let index = 1; index < 20; index += 1) await payments.createOrder('owner-1', purchase, `new-${index}`);
    await expect(payments.createOrder('owner-1', purchase, 'excess')).rejects.toThrow('Too many payment orders');
    expect((await payments.createOrder('owner-1', purchase, 'first')).id).toBe(first.id);
    await expect(payments.createOrder('owner-2', purchase, 'excess')).resolves.toMatchObject({ userId: 'owner-2' });
  });

  it('rejects conflicting adjustments and cannot reopen a fully refunded order', async () => {
    const order = await bought();
    await expect(payments.applyAdjustment('', capture.id, 'refund', 100)).rejects.toThrow('Invalid payment adjustment');
    await expect(payments.applyAdjustment('bad', capture.id, 'refund', 0)).rejects.toThrow('Invalid payment adjustment');
    await payments.applyAdjustment('full', capture.id, 'refund', 499);
    await payments.applyAdjustment('later-dispute', capture.id, 'dispute', 0);
    expect((await payments.getOrder(order.id))?.status).toBe('refunded');
    await expect(payments.applyAdjustment('full', 'OTHER', 'refund', 499)).rejects.toThrow('Conflicting');
    await expect(payments.applyAdjustment('full', capture.id, 'refund', 100)).rejects.toThrow('Conflicting');
    await expect(transaction((client) => reservePurchasedImageCredit(client, imageReservation('no-lot')))).resolves.toBe(false);
  });

  it('never reserves a returned job again and refuses missing or free-only reservations in the paid helper', async () => {
    await bought();
    await transaction((client) => reservePurchasedImageCredit(client, imageReservation('paid-job')));
    await transaction((client) => refundPurchasedImageCredit(client, imageReservation('paid-job')));
    await expect(transaction((client) => reservePurchasedImageCredit(client, imageReservation('paid-job')))).rejects.toThrow('Invalid image credit');
    await expect(transaction((client) => consumePurchasedImageCredit(client, imageReservation('paid-job')))).rejects.toThrow('Invalid image credit');
    await benefits.reserve('free-job', 'owner-1');
    await expect(transaction((client) => reservePurchasedImageCredit(client, imageReservation('free-job')))).rejects.toThrow();
    await expect(transaction((client) => consumePurchasedImageCredit(client, imageReservation('missing')))).rejects.toThrow();
    await expect(transaction((client) => refundPurchasedImageCredit(client, imageReservation('missing')))).rejects.toThrow();
    await expect(transaction((client) => reservePurchasedImageCredit(client, imageReservation('', 'owner-1')))).rejects.toThrow();
    await expect(transaction((client) => reservePurchasedImageCredit(client, imageReservation('missing-owner', 'uninitialized')))).rejects.toThrow('account is unavailable');
    expect((await benefits.getSummary('owner-1')).paidBalance).toBe(5);
  });

  it('makes the additive migration safe to apply again without modifying current records', async () => {
    await bought();
    await db.query("INSERT INTO processing_accounts(owner_id,available_credits) VALUES ('owner-1',20)");
    await db.exec(await readFile('db/migrations/008_paypal_image_payments.sql', 'utf8'));
    expect(await benefits.getSummary('owner-1')).toMatchObject({ balance: 1, paidBalance: 5 });
    expect((await db.query<{ available_credits: number }>('SELECT available_credits FROM processing_accounts')).rows[0].available_credits).toBe(20);
  });

  it('prices each paid image operation while free uses remain one and retries retain their original cost', async () => {
    await bought();
    const costs = { 'watermark-removal': 2, 'background-removal': 3, 'object-removal': 4 };
    const priced = new PostgresBenefitStore(pool, true, 'live', costs);
    costs['background-removal'] = 99; // The constructed service keeps its price snapshot.
    await priced.reserve('free-job', 'owner-1', 'object-removal');
    await priced.consume('free-job', 'owner-1');
    expect(await priced.getSummary('owner-1')).toMatchObject({ balance: 0, paidBalance: 5 });
    await priced.reserve('background-job', 'owner-1', 'background-removal');
    expect((await priced.getSummary('owner-1')).paidBalance).toBe(2);
    await new PostgresBenefitStore(pool, true, 'live', { 'background-removal': 100 }).reserve('background-job', 'owner-1', 'background-removal');
    expect((await priced.getSummary('owner-1')).paidBalance).toBe(2);
    await priced.refund('background-job', 'owner-1');
    expect((await priced.getSummary('owner-1')).paidBalance).toBe(5);
    await priced.reserve('watermark-job', 'owner-1', 'watermark-removal');
    expect((await priced.getSummary('owner-1')).paidBalance).toBe(3);
    await priced.refund('watermark-job', 'owner-1');
    await priced.reserve('object-job', 'owner-1', 'object-removal');
    await priced.consume('object-job', 'owner-1');
    await priced.refund('object-job', 'owner-1');
    expect(await priced.getSummary('owner-1')).toMatchObject({ balance: 0, paidBalance: 1 });
  });

  it('allocates a quantity across FIFO purchase lots and freezes/refunds only the original allocation segments', async () => {
    const first = await bought();
    const second = await payments.createOrder('owner-1', purchase, 'second-lot');
    await payments.attachPaypalOrder(second.id, 'PPORDER2');
    await payments.fulfill(second.id, { ...capture, id: 'CAPTURE2', paypalOrderId: 'PPORDER2' });
    await db.query('UPDATE paid_credit_lots SET created_at=$2 WHERE id=$1', [first.id, '2020-01-01T00:00:00Z']);
    await db.query("INSERT INTO processing_accounts(owner_id,available_credits) VALUES ('owner-1',77)");
    await transaction((client) => reservePurchasedImageCredit(client, { ...imageReservation('multi-job'), amount: 7 }));
    const allocations = await db.query<{ lot_id: string; amount: number }>('SELECT lot_id,amount FROM paid_credit_allocations WHERE job_id=$1 ORDER BY amount DESC', ['multi-job']);
    expect(allocations.rows).toEqual([{ lot_id: first.id, amount: 5 }, { lot_id: second.id, amount: 2 }]);
    await transaction((client) => reservePurchasedImageCredit(client, { ...imageReservation('multi-job'), amount: 99 }));
    expect((await benefits.getSummary('owner-1')).paidBalance).toBe(3);
    // The affected lot is the second allocation, not job_credit_reservations.lot_id.
    await payments.applyAdjustment('refund:second-lot', 'CAPTURE2', 'refund', 499);
    expect((await payments.getOrder(second.id))?.status).toBe('review');
    await transaction((client) => refundPurchasedImageCredit(client, { ...imageReservation('multi-job'), amount: 123 }));
    await transaction((client) => refundPurchasedImageCredit(client, imageReservation('multi-job')));
    expect((await benefits.getSummary('owner-1')).paidBalance).toBe(5);
    expect((await db.query<{ available: number }>('SELECT available FROM paid_credit_lots WHERE id=$1', [first.id])).rows[0].available).toBe(5);
    expect((await db.query<{ available: number; status: string }>('SELECT available,status FROM paid_credit_lots WHERE id=$1', [second.id])).rows[0]).toEqual({ available: 0, status: 'frozen' });
    expect((await db.query<{ delta: number }>("SELECT delta FROM paid_credit_ledger WHERE reason='job_refund' AND reference_id='multi-job'")).rows).toEqual([{ delta: 5 }]);
    expect((await db.query<{ delta: number }>("SELECT delta FROM paid_credit_ledger WHERE reason='job_refund_frozen' AND reference_id='multi-job'")).rows).toEqual([{ delta: 0 }]);
    expect((await db.query<{ available_credits: number }>('SELECT available_credits FROM processing_accounts')).rows[0].available_credits).toBe(77);
  });

  it('does not partially debit a shortfall and rejects unsafe paid quantities', async () => {
    await bought();
    expect(await transaction((client) => reservePurchasedImageCredit(client, { ...imageReservation('shortfall'), amount: 6 }))).toBe(false);
    for (const amount of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(transaction((client) => reservePurchasedImageCredit(client, { ...imageReservation('invalid-quantity'), amount }))).rejects.toThrow('Invalid image credit amount');
    }
    expect((await benefits.getSummary('owner-1')).paidBalance).toBe(5);
    expect((await db.query('SELECT job_id FROM paid_credit_allocations')).rows).toHaveLength(0);
    expect((await db.query("SELECT id FROM paid_credit_ledger WHERE reason='job_reserve'")).rows).toHaveLength(0);
  });

  it('preserves and backfills an old single-lot reservation as one credit', async () => {
    const order = await bought();
    await db.query('UPDATE paid_credit_lots SET available=4 WHERE id=$1', [order.id]);
    await db.query("INSERT INTO job_credit_reservations(job_id,user_id,status,source,lot_id) VALUES ('old-job','owner-1','reserved','paid',$1)", [order.id]);
    await db.query("INSERT INTO paid_credit_ledger(user_id,lot_id,delta,balance_after,reason,reference_id) VALUES ('owner-1',$1,-1,4,'job_reserve','old-job')", [order.id]);
    // A pre-upgrade paid reservation can be settled/restored even before its
    // additive allocation backfill, with its original one-credit meaning.
    await transaction((client) => reservePurchasedImageCredit(client, { ...imageReservation('old-job'), amount: 900 }));
    await db.exec(await readFile('db/migrations/008_paypal_image_payments.sql', 'utf8'));
    expect((await db.query<{ amount: number }>('SELECT amount FROM paid_credit_allocations WHERE job_id=$1', ['old-job'])).rows).toEqual([{ amount: 1 }]);
    await transaction((client) => refundPurchasedImageCredit(client, imageReservation('old-job')));
    expect((await benefits.getSummary('owner-1')).paidBalance).toBe(5);
  });

  it('applies the approved 100/10/10 paid costs while keeping a free operation one use and administrator credits unchanged', async () => {
    const order = await payments.createOrder('owner-1', { ...purchase, credits: 4990 }, 'approved-starter');
    await payments.attachPaypalOrder(order.id, capture.paypalOrderId);
    await payments.fulfill(order.id, capture);
    await db.query("INSERT INTO processing_accounts(owner_id,available_credits) VALUES ('owner-1',77)");
    const priced = new PostgresBenefitStore(pool, true, 'live', {
      'watermark-removal': 100, 'background-removal': 10, 'object-removal': 10,
    });
    await priced.reserve('approved-free', 'owner-1', 'watermark-removal');
    await priced.consume('approved-free', 'owner-1');
    expect(await priced.getSummary('owner-1')).toMatchObject({ balance: 0, paidBalance: 4990 });
    for (const [job, operation] of [
      ['approved-watermark', 'watermark-removal'], ['approved-background', 'background-removal'], ['approved-object', 'object-removal'],
    ] as const) {
      await priced.reserve(job, 'owner-1', operation);
      await priced.consume(job, 'owner-1');
    }
    expect((await priced.getSummary('owner-1')).paidBalance).toBe(4870);
    await priced.reserve('approved-failure', 'owner-1', 'object-removal');
    await priced.refund('approved-failure', 'owner-1');
    expect((await priced.getSummary('owner-1')).paidBalance).toBe(4870);
    expect((await db.query<{ available_credits: number }>('SELECT available_credits FROM processing_accounts')).rows[0].available_credits).toBe(77);
  });

  it('requires consent for a new paid price but keeps free use and uncertain old-job retries safe', async () => {
    const order = await payments.createOrder('owner-1', { ...purchase, credits: 4990 }, 'consent-starter');
    await payments.attachPaypalOrder(order.id, capture.paypalOrderId);
    await payments.fulfill(order.id, capture);
    await db.query("INSERT INTO processing_accounts(owner_id,available_credits) VALUES ('owner-1',77)");
    const priced = new PostgresBenefitStore(pool, true, 'live', {
      'watermark-removal': 100, 'background-removal': 10, 'object-removal': 10,
    }, 'approved-cost-v1');
    await priced.reserve('consent-free', 'owner-1', 'watermark-removal');
    await priced.consume('consent-free', 'owner-1');
    for (const consent of [
      undefined,
      { imageCostVersion: 'old-version', maxImageCredits: 100 },
      { imageCostVersion: 'approved-cost-v1', maxImageCredits: 99 },
      { imageCostVersion: 'approved-cost-v1', maxImageCredits: 0 },
      { imageCostVersion: 'approved-cost-v1', maxImageCredits: 100.5 },
      { imageCostVersion: 'approved-cost-v1', maxImageCredits: Number.NaN },
      { imageCostVersion: 'approved-cost-v1', maxImageCredits: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      await expect(priced.reserve('consent-rejected', 'owner-1', 'watermark-removal', consent)).rejects.toMatchObject({
        code: 'image_price_changed', message: 'Review the current image credit price and confirm again.',
      });
    }
    expect(await priced.getSummary('owner-1')).toMatchObject({ balance: 0, paidBalance: 4990 });
    expect((await db.query("SELECT job_id FROM job_credit_reservations WHERE source='paid'")).rows).toHaveLength(0);
    expect((await db.query('SELECT job_id FROM paid_credit_allocations')).rows).toHaveLength(0);
    expect((await db.query("SELECT id FROM paid_credit_ledger WHERE reason='job_reserve'")).rows).toHaveLength(0);
    await priced.reserve('consent-accepted', 'owner-1', 'watermark-removal', { imageCostVersion: 'approved-cost-v1', maxImageCredits: 100 });
    await new PostgresBenefitStore(pool, true, 'live', { 'watermark-removal': 1000 }, 'new-cost-v2').reserve('consent-accepted', 'owner-1', 'watermark-removal');
    expect((await priced.getSummary('owner-1')).paidBalance).toBe(4890);
    expect(Number((await db.query<{ amount: number }>('SELECT amount FROM job_credit_reservations WHERE job_id=$1', ['consent-accepted'])).rows[0].amount)).toBe(100);
    await priced.refund('consent-accepted', 'owner-1');
    expect((await priced.getSummary('owner-1')).paidBalance).toBe(4990);
    expect((await db.query<{ available_credits: number }>('SELECT available_credits FROM processing_accounts')).rows[0].available_credits).toBe(77);
  });
});
