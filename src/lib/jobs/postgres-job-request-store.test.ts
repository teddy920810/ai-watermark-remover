import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createJob } from './job';
import { PostgresJobRequestStore } from './postgres-job-request-store';
import { PostgresBenefitStore } from '../benefits/postgres-benefit-store';
import { PostgresPaymentStore } from '../payments/postgres-payment-store';

// Real migration and SQL execution. PGlite has one connection, so this covers
// atomic/idempotent effects with serialized transactions, not Postgres lock contention.
const db = new PGlite();
let queue = Promise.resolve();
const pool = {
  query: (sql: string, parameters?: unknown[]) => db.query(sql, parameters),
  async connect() {
    const previous = queue;
    let release = () => {};
    queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    return { query: (sql: string, parameters?: unknown[]) => db.query(sql, parameters), release };
  },
} as unknown as Pool;
const requests = new PostgresJobRequestStore(pool);
const input = 'uploads/users/owner/input.png';

beforeAll(async () => {
  for (const file of (await readdir('db/migrations')).filter((name) => name.endsWith('.sql')).sort()) {
    await db.exec(await readFile(`db/migrations/${file}`, 'utf8'));
  }
}, 30_000);
beforeEach(async () => { await db.exec('TRUNCATE processing_requests,processing_admissions,processing_credit_ledger,processing_accounts,processing_outbox,payment_events,payment_adjustments,payment_orders,user_benefits CASCADE'); });
afterAll(async () => { await db.close(); });

describe('durable processing request claims', () => {
  it('claims one operation once across independent service instances', async () => {
    const another = new PostgresJobRequestStore(pool);
    const claims = await Promise.all([
      requests.claim(createJob('job-one', input, 'owner')),
      another.claim(createJob('job-two', input, 'owner')),
    ]);
    expect(claims.filter((claim) => claim.acquired)).toHaveLength(1);
    expect(claims[1].request.id).toBe(claims[0].request.id);
    expect((await db.query('SELECT * FROM processing_requests')).rows).toHaveLength(1);
    const expiry = Date.parse(claims[0].request.leaseExpiresAt) - Date.parse(claims[0].request.createdAt);
    expect(expiry).toBe(15 * 60_000);
  });

  it('separates environment, owner, operation and selection mask', async () => {
    const first = createJob('first', input, 'owner');
    await requests.claim(first);
    for (const job of [
      createJob('other-owner', input, 'another'),
      createJob('other-operation', input, 'owner', undefined, 'background-removal'),
      createJob('object-one', input, 'owner', undefined, 'object-removal', 'mask-one.png'),
      createJob('object-two', input, 'owner', undefined, 'object-removal', 'mask-two.png'),
    ]) expect((await requests.claim(job)).acquired).toBe(true);
    const live = new PostgresJobRequestStore(pool, 'live');
    expect((await live.claim({ ...first, id: 'live' })).acquired).toBe(true);
    expect(await live.get(first.id)).toBeNull();
    await expect(live.complete(first.id)).rejects.toThrow('Job request not found');
    expect((await requests.get(first.id))?.status).toBe('processing');
  });

  it('keeps terminal outcomes immutable and replays their original job identity', async () => {
    await requests.claim(createJob('success', input, 'owner'));
    expect((await requests.complete('success')).status).toBe('completed');
    expect((await requests.fail('success')).status).toBe('completed');
    expect((await requests.expire('success')).status).toBe('completed');
    expect(await requests.claim(createJob('retry', input, 'owner'))).toMatchObject({ acquired: false, request: { id: 'success', status: 'completed' } });
    await requests.claim(createJob('failure', 'another-input', 'owner'));
    expect((await requests.fail('failure')).status).toBe('failed');
    expect((await requests.complete('failure')).status).toBe('failed');
  });

  it('expires only abandoned processing claims and refuses late completion', async () => {
    await requests.claim(createJob('active', input, 'owner'));
    expect((await requests.expire('active')).status).toBe('processing');
    await db.query("UPDATE processing_requests SET lease_expires_at=NOW()-INTERVAL '1 minute' WHERE job_id=$1", ['active']);
    expect((await requests.complete('active')).status).toBe('processing');
    expect((await requests.expire('active')).status).toBe('failed');
    expect((await requests.complete('active')).status).toBe('failed');
    expect(await requests.get('unknown')).toBeNull();
  });

  it('distinguishes a crash before reserve from a real reservation without changing credits', async () => {
    await requests.claim(createJob('job', input, 'owner'));
    expect(await requests.reservationStatus('job', 'owner')).toBeNull();
    await db.query("INSERT INTO user_benefits(user_id) VALUES ('owner')");
    await db.query("INSERT INTO job_credit_reservations(job_id,user_id,status) VALUES ('job','owner','reserved')");
    expect(await requests.reservationStatus('job', 'owner')).toBe('reserved');
    expect(await requests.reservationStatus('job', 'another')).toBeNull();
    expect(await new PostgresJobRequestStore(pool, 'live').reservationStatus('job', 'owner')).toBeNull();
    await db.query("UPDATE job_credit_reservations SET status='consumed' WHERE job_id='job'");
    expect(await requests.reservationStatus('job', 'owner')).toBe('consumed');
    await db.query("UPDATE job_credit_reservations SET status='refunded' WHERE job_id='job'");
    expect(await requests.reservationStatus('job', 'owner')).toBe('refunded');
    expect((await db.query<{ balance: number }>("SELECT balance FROM user_benefits WHERE user_id='owner'")).rows[0].balance).toBe(1);
  });

  it('recovers the correct paid batch through its order environment without exposing it to live', async () => {
    const payments = new PostgresPaymentStore(pool);
    const benefits = new PostgresBenefitStore(pool, true);
    const order = await payments.createOrder('owner', { sku: 'starter', credits: 5, amountCents: 499, currency: 'USD', catalogVersion: 'test' }, 'request');
    await payments.attachPaypalOrder(order.id, 'paypal-order');
    await payments.fulfill(order.id, { id: 'capture', paypalOrderId: 'paypal-order', amountCents: 499, currency: 'USD', merchantId: 'merchant' });
    await benefits.reserve('free', 'owner');
    await benefits.consume('free', 'owner');
    await requests.claim(createJob('paid', input, 'owner'));
    await benefits.reserve('paid', 'owner');
    expect(await requests.reservationStatus('paid', 'owner')).toBe('reserved');
    expect(await new PostgresJobRequestStore(pool, 'live').reservationStatus('paid', 'owner')).toBeNull();
    expect((await benefits.getSummary('owner')).paidBalance).toBe(4);
    await benefits.refund('paid', 'owner');
    expect(await requests.reservationStatus('paid', 'owner')).toBe('refunded');
    expect((await benefits.getSummary('owner')).paidBalance).toBe(5);
  });

  it('selects only expired or unsettled terminal requests for the requested owner and environment', async () => {
    for (const id of ['expired', 'active', 'completed', 'failed-without-reservation']) {
      await requests.claim(createJob(id, `${input}-${id}`, 'owner'));
    }
    await requests.claim(createJob('another-owner', input, 'another'));
    await new PostgresJobRequestStore(pool, 'live').claim(createJob('another-environment', input, 'owner'));
    await requests.complete('completed');
    await requests.fail('failed-without-reservation');
    await db.query("INSERT INTO user_benefits(user_id) VALUES ('owner')");
    await db.query("INSERT INTO job_credit_reservations(job_id,user_id,status) VALUES ('completed','owner','reserved')");
    await db.exec("UPDATE processing_requests SET lease_expires_at=NOW()-INTERVAL '1 minute' WHERE job_id IN ('expired','another-owner','another-environment')");
    expect((await requests.recoverable('owner')).map((entry) => entry.id).sort()).toEqual(['completed', 'expired']);
    await db.exec("UPDATE job_credit_reservations SET status='consumed' WHERE job_id='completed'");
    expect((await requests.recoverable('owner')).map((entry) => entry.id)).toEqual(['expired']);
  });

  it('bounds one account recovery batch to twenty requests', async () => {
    for (let index = 0; index < 25; index += 1) await requests.claim(createJob(`job-${index}`, `${input}-${index}`, 'owner'));
    await db.exec("UPDATE processing_requests SET lease_expires_at=NOW()-INTERVAL '1 minute'");
    const batch = await requests.recoverable('owner');
    expect(batch).toHaveLength(20);
    expect(new Set(batch.map((entry) => entry.id)).size).toBe(20);
  });
  it('releases only an owned unadmitted claim so a later explicit attempt can claim the same upload', async () => {
    await db.exec("INSERT INTO user_benefits(user_id) VALUES ('owner'),('another')");
    await requests.claim(createJob('not-admitted', input, 'owner'));
    await expect(requests.releaseUnreservedRequest('another', 'not-admitted')).rejects.toThrow();
    expect(await requests.get('not-admitted')).not.toBeNull();
    await requests.releaseUnreservedRequest('owner', 'not-admitted');
    expect(await requests.get('not-admitted')).toBeNull();
    expect(await requests.claim(createJob('new-attempt', input, 'owner'))).toMatchObject({ acquired: true, request: { id: 'new-attempt' } });
    expect((await db.query('SELECT * FROM job_credit_reservations')).rows).toHaveLength(0);
  });
  it.each(['reserved', 'consumed', 'refunded'])('refuses to release a claim with any %s financial reservation', async (status) => {
    await db.exec("INSERT INTO user_benefits(user_id) VALUES ('owner')");
    await requests.claim(createJob('financial', input, 'owner'));
    await db.query('INSERT INTO job_credit_reservations(job_id,user_id,status) VALUES ($1,$2,$3)', ['financial', 'owner', status]);
    await expect(requests.releaseUnreservedRequest('owner', 'financial')).rejects.toThrow();
    expect(await requests.get('financial')).not.toBeNull();
    expect((await db.query('SELECT * FROM job_credit_reservations')).rows).toHaveLength(1);
  });
  it.each(['benefit-ledger', 'processing-admission', 'processing-ledger', 'paid-ledger'])('refuses release when an independent %s financial record exists', async (record) => {
    await db.exec("INSERT INTO user_benefits(user_id) VALUES ('owner')");
    await requests.claim(createJob('financial-record', input, 'owner'));
    if (record === 'benefit-ledger') await db.exec("INSERT INTO benefit_ledger(user_id,delta,balance_after,reason,reference_id) VALUES ('owner',-1,0,'job_reserve','financial-record')");
    else if (record === 'processing-admission') await db.exec("INSERT INTO processing_admissions(job_id,owner_id,operation_key,request_hash,amount,unit,status) VALUES ('financial-record','owner','operation','hash',1,'freeUses','reserved')");
    else if (record === 'processing-ledger') {
      await db.exec("INSERT INTO processing_accounts(owner_id) VALUES ('owner')");
      await db.exec("INSERT INTO processing_credit_ledger(owner_id,delta,balance_after,reason,reference_id) VALUES ('owner',-1,0,'reserve','financial-record')");
    } else {
      const payments = new PostgresPaymentStore(pool);
      const order = await payments.createOrder('owner', { sku: 'starter', credits: 5, amountCents: 499, currency: 'USD', catalogVersion: 'test' }, 'financial-order');
      await payments.attachPaypalOrder(order.id, 'financial-paypal');
      await payments.fulfill(order.id, { id: 'financial-capture', paypalOrderId: 'financial-paypal', amountCents: 499, currency: 'USD', merchantId: 'merchant' });
      const lot = (await db.query<{ id: string }>('SELECT id FROM paid_credit_lots WHERE order_id=$1', [order.id])).rows[0];
      await db.query("INSERT INTO paid_credit_ledger(user_id,lot_id,delta,balance_after,reason,reference_id) VALUES ('owner',$1,0,5,'job_refund_frozen','financial-record')", [lot.id]);
    }
    await expect(requests.releaseUnreservedRequest('owner', 'financial-record')).rejects.toThrow();
    expect(await requests.get('financial-record')).not.toBeNull();
  });
  it('allows only one of two competing release calls and never deletes terminal coordination', async () => {
    await db.exec("INSERT INTO user_benefits(user_id) VALUES ('owner')");
    await requests.claim(createJob('release-once', input, 'owner'));
    const outcomes = await Promise.allSettled([requests.releaseUnreservedRequest('owner', 'release-once'), new PostgresJobRequestStore(pool).releaseUnreservedRequest('owner', 'release-once')]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    await requests.claim(createJob('terminal', input, 'owner'));
    await requests.fail('terminal');
    await expect(requests.releaseUnreservedRequest('owner', 'terminal')).rejects.toThrow();
    expect((await requests.get('terminal'))?.status).toBe('failed');
  });
});
