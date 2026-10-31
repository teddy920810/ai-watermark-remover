import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresBenefitStore } from '../benefits/postgres-benefit-store';
import { createJob } from '../jobs/job';
import { PostgresJobRequestStore } from '../jobs/postgres-job-request-store';
import { PostgresProcessingStore } from '../processing/postgres-processing-store';
import { PostgresPaymentStore } from './postgres-payment-store';
import { reservePurchasedImageCredit } from './image-credit-wallet';

// Opt-in only. Credentials are injected by a local operator/ignored runner;
// ordinary unit tests and CI never connect to a database from this file.
const databaseUrl = process.env.PAYMENT_TEST_DATABASE_URL;
const normalizeHost = (host: string) => host.toLowerCase().replace(/-pooler(?=\.)/, '');
const schema = `paypal_live_qa_${randomUUID().replaceAll('-', '')}`;
const validSchema = () => /^paypal_live_qa_[a-f0-9]{32}$/.test(schema);
let created = false;
let pool: Pool;
let payments: PostgresPaymentStore;
let benefits: PostgresBenefitStore;
let finance: PostgresProcessingStore;
const owner = 'qa-owner';
const captureId = `QA${randomUUID().replaceAll('-', '').toUpperCase()}`;
const paypalOrderId = `QA${randomUUID().replaceAll('-', '').toUpperCase()}`;
const capture = { id: captureId, paypalOrderId, amountCents: 499, currency: 'USD' as const, merchantId: 'QA-MERCHANT' };
const purchase = { sku: 'qa-image-uses', credits: 5, amountCents: 499, currency: 'USD' as const, catalogVersion: 'concurrency-qa' };
const request = { jobId: 'qa-image-job', ownerId: owner, idempotencyKey: 'qa-operation', requestHash: 'qa-sealed-quote', amount: 1, unit: 'purchasedImageCredits' as const, now: '2026-10-31T00:00:00.000Z' };

function assertIsolation() {
  if (!databaseUrl || process.env.PAYMENT_TEST_DATABASE_KIND !== 'isolated-sandbox') throw new Error('An explicitly isolated Sandbox database is required');
  const url = new URL(databaseUrl);
  const expected = process.env.PAYMENT_TEST_SANDBOX_HOST;
  const production = process.env.PAYMENT_TEST_PRODUCTION_HOST;
  const host = normalizeHost(url.hostname);
  // Neon transaction pooling cannot preserve the session search_path used for
  // strict schema isolation: https://neon.com/docs/connect/connection-pooling
  if (/-pooler\./.test(url.hostname)) throw new Error('The isolated schema test requires the direct Sandbox endpoint');
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !host.endsWith('.neon.tech') || !expected || !production
    || host !== normalizeHost(expected) || host === normalizeHost(production) || !validSchema()) throw new Error('Database isolation checks failed');
}
const control = () => new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10_000, options: '-c search_path=pg_catalog -c statement_timeout=30000' });

async function baseline() {
  const order = await payments.createOrder(owner, purchase, 'qa-purchase');
  await payments.attachPaypalOrder(order.id, paypalOrderId);
  await payments.fulfill(order.id, capture);
  // Consume the normal initial free use through its real financial contract.
  await benefits.reserve('qa-baseline-free', owner);
  await benefits.consume('qa-baseline-free', owner);
  await finance.grantCredits(owner, 77, 'qa-admin-allocation', 'admin:isolated-test');
  return order;
}
async function invariant(paid: number) {
  expect(await finance.getBalance(owner, 'purchasedImageCredits')).toBe(paid);
  expect(await finance.getBalance(owner, 'freeUses')).toBe(0);
  expect(await finance.getBalance(owner, 'processingCredits')).toBe(77);
  const ledger = await pool.query<{ total: string }>('SELECT COALESCE(SUM(delta),0)::text AS total FROM paid_credit_ledger WHERE user_id=$1', [owner]);
  expect(Number(ledger.rows[0].total)).toBe(paid);
  const invalid = await pool.query('SELECT id FROM paid_credit_lots WHERE available<0 OR available>granted OR (status=\'frozen\' AND available<>0)');
  expect(invalid.rows).toHaveLength(0);
}

describe.skipIf(!databaseUrl)('real isolated PostgreSQL payment concurrency', () => {
  beforeAll(async () => {
    assertIsolation();
    const admin = control();
    try {
      await admin.connect();
      const exists = await admin.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [schema]);
      if (exists.rows.length) throw new Error('The generated QA schema already exists; refusing to reuse it');
      await admin.query(`CREATE SCHEMA "${schema}"`);
      created = true;
    } finally { await admin.end(); }
    pool = new Pool({ connectionString: databaseUrl, max: 6, idleTimeoutMillis: 2_000, connectionTimeoutMillis: 10_000,
      application_name: schema, options: `-c search_path=${schema},pg_catalog -c lock_timeout=15000 -c statement_timeout=30000` });
    const client = await pool.connect();
    try {
      const active = await client.query<{ current_schema: string }>('SELECT current_schema()');
      if (active.rows[0].current_schema !== schema) throw new Error('The QA schema search path was not applied');
      await client.query('BEGIN');
      for (const name of (await readdir('db/migrations')).filter((file) => /^\d+_[a-z0-9_-]+\.sql$/i.test(file)).sort()) {
        await client.query(await readFile(`db/migrations/${name}`, 'utf8'));
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    payments = new PostgresPaymentStore(pool, 'sandbox');
    benefits = new PostgresBenefitStore(pool, true, 'sandbox');
    finance = new PostgresProcessingStore(pool, { imageCreditsEnabled: true, paymentEnvironment: 'sandbox' });
  }, 90_000);

  beforeEach(async () => {
    await pool.query('TRUNCATE payment_orders,payment_events,payment_adjustments,user_benefits,processing_accounts,processing_admissions,processing_outbox CASCADE');
  }, 30_000);

  afterAll(async () => {
    if (pool) await pool.end();
    // Only remove the exact unique schema created by this run. Never clean up
    // an existing namespace, public, or a schema derived from external input.
    if (!created) return;
    assertIsolation();
    if (!validSchema()) throw new Error('QA schema cleanup validation failed');
    const admin = control();
    try {
      await admin.connect();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      const remaining = await admin.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [schema]);
      expect(remaining.rows).toHaveLength(0);
      created = false;
    } finally { await admin.end(); }
  }, 60_000);

  it('serializes duplicate fulfillment on multiple actual connections', async () => {
    const order = await payments.createOrder(owner, purchase, 'qa-purchase');
    await payments.attachPaypalOrder(order.id, paypalOrderId);
    const results = await Promise.all(Array.from({ length: 6 }, () => payments.fulfill(order.id, capture)));
    expect(results.every((item) => item.status === 'fulfilled')).toBe(true);
    expect(pool.totalCount).toBeGreaterThanOrEqual(2);
    expect((await pool.query("SELECT id FROM paid_credit_ledger WHERE reason='purchase'")).rows).toHaveLength(1);
    expect((await pool.query('SELECT id FROM paid_credit_lots')).rows).toHaveLength(1);
    expect((await benefits.getSummary(owner)).paidBalance).toBe(5);
  }, 60_000);

  it('serializes admission against a payment refund without negative balances or administrator-credit changes', async () => {
    const order = await baseline();
    const [admitted, refunded] = await Promise.allSettled([
      finance.reserveAndEnqueue(request), payments.applyAdjustment('refund:qa-race', captureId, 'refund', 499),
    ]);
    expect(refunded.status).toBe('fulfilled');
    if (admitted.status === 'rejected') expect(admitted.reason).toMatchObject({ code: 'insufficient_balance' });
    else await finance.refund(request.jobId, owner, 'qa-provider-failure');
    expect(['review', 'refunded']).toContain((await payments.getOrder(order.id))?.status);
    await invariant(0);
  }, 60_000);

  it('races a job failure return with payment freezing and never revives the purchase', async () => {
    await baseline();
    await finance.reserveAndEnqueue(request);
    await Promise.all([
      finance.refund(request.jobId, owner, 'qa-provider-failure'),
      payments.applyAdjustment('refund:qa-freeze', captureId, 'refund', 499),
    ]);
    await finance.refund(request.jobId, owner, 'qa-repeat-failure');
    const returned = await pool.query("SELECT reason FROM paid_credit_ledger WHERE reason IN ('job_refund','job_refund_frozen')");
    expect(returned.rows).toHaveLength(1);
    expect((await finance.getAdmission(request.jobId))?.status).toBe('refunded');
    await invariant(0);
  }, 60_000);

  it('races successful settlement with payment freezing while preserving one consumed reservation', async () => {
    await baseline();
    await finance.reserveAndEnqueue(request);
    await Promise.all([
      finance.settle(request.jobId, owner),
      payments.applyAdjustment('refund:qa-settle', captureId, 'refund', 499),
    ]);
    await finance.settle(request.jobId, owner);
    await finance.refund(request.jobId, owner, 'qa-late-failure');
    expect((await finance.getAdmission(request.jobId))?.status).toBe('settled');
    expect((await pool.query<{ status: string }>('SELECT status FROM job_credit_reservations WHERE job_id=$1', [request.jobId])).rows[0].status).toBe('consumed');
    expect((await payments.getOrderByCaptureId(captureId))?.status).toBe('review');
    await invariant(0);
  }, 60_000);

  it('rejects concurrent cross-owner access without changing either owner entitlement', async () => {
    await baseline();
    await finance.reserveAndEnqueue(request);
    await benefits.getSummary('qa-other-owner');
    const attempts = await Promise.allSettled([
      finance.settle(request.jobId, 'qa-other-owner'),
      finance.refund(request.jobId, 'qa-other-owner', 'qa-forbidden'),
      benefits.consume(request.jobId, 'qa-other-owner'),
      benefits.refund(request.jobId, 'qa-other-owner'),
    ]);
    expect(attempts.every((result) => result.status === 'rejected')).toBe(true);
    expect((await benefits.getSummary('qa-other-owner')).balance).toBe(1);
    expect((await benefits.getSummary('qa-other-owner')).paidBalance).toBe(0);
    expect((await finance.getAdmission(request.jobId))?.status).toBe('reserved');
    await invariant(4);
  }, 60_000);

  it('deduplicates concurrent inbox writes and financial adjustments', async () => {
    await baseline();
    const event = { id: 'qa-financial-event', eventType: 'PAYMENT.CAPTURE.REFUNDED', resourceId: 'qa-refund', payload: { resourceId: 'qa-refund' } };
    await Promise.all(Array.from({ length: 6 }, () => payments.recordEvent(event)));
    expect((await pool.query('SELECT id FROM payment_events')).rows).toHaveLength(1);
    await Promise.all(Array.from({ length: 6 }, () => payments.completeEvent(event.id)));
    expect(await payments.recordEvent(event)).toBe(false);
    await Promise.all(Array.from({ length: 6 }, () => payments.applyAdjustment('refund:qa-duplicate', captureId, 'refund', 499)));
    expect((await pool.query('SELECT id FROM payment_adjustments')).rows).toHaveLength(1);
    expect((await pool.query("SELECT id FROM paid_credit_ledger WHERE reason='adjustment'")).rows).toHaveLength(1);
    await invariant(0);
  }, 60_000);

  it('reserves a multi-lot quantity once, rejects shortfall without a partial debit, and freezes only the affected allocation', async () => {
    const first = await baseline();
    const second = await payments.createOrder(owner, purchase, 'qa-second-purchase');
    await payments.attachPaypalOrder(second.id, `${paypalOrderId}SECOND`);
    await payments.fulfill(second.id, { ...capture, id: `${captureId}SECOND`, paypalOrderId: `${paypalOrderId}SECOND` });
    await pool.query('UPDATE paid_credit_lots SET created_at=$2 WHERE id=$1', [first.id, '2020-01-01T00:00:00Z']);
    await expect(finance.reserveAndEnqueue({ ...request, jobId: 'qa-shortfall', idempotencyKey: 'qa-shortfall', amount: 11 })).rejects.toMatchObject({ code: 'insufficient_balance' });
    await invariant(10);
    expect((await pool.query('SELECT job_id FROM paid_credit_allocations')).rows).toHaveLength(0);
    const outcomes = await Promise.all([
      finance.reserveAndEnqueue({ ...request, amount: 7 }),
      finance.reserveAndEnqueue({ ...request, amount: 7 }),
    ]);
    expect(outcomes.filter((outcome) => outcome.created)).toHaveLength(1);
    const allocation = await pool.query<{ amount: number }>('SELECT amount FROM paid_credit_allocations WHERE job_id=$1 ORDER BY amount DESC', [request.jobId]);
    expect(allocation.rows).toEqual([{ amount: 5 }, { amount: 2 }]);
    await payments.applyAdjustment('refund:qa-second-lot', `${captureId}SECOND`, 'refund', 499);
    expect((await payments.getOrder(second.id))?.status).toBe('review');
    await Promise.all([
      finance.refund(request.jobId, owner, 'qa-variable-cost-failure'),
      finance.refund(request.jobId, owner, 'qa-variable-cost-failure-retry'),
    ]);
    expect((await pool.query<{ delta: number }>("SELECT delta FROM paid_credit_ledger WHERE reason='job_refund' AND reference_id=$1", [request.jobId])).rows).toEqual([{ delta: 5 }]);
    expect((await pool.query<{ delta: number }>("SELECT delta FROM paid_credit_ledger WHERE reason='job_refund_frozen' AND reference_id=$1", [request.jobId])).rows).toEqual([{ delta: 0 }]);
    await invariant(5);
  }, 90_000);

  it('keeps approved 100/10/10 prices consistent across the new pipeline and legacy image tools', async () => {
    const order = await payments.createOrder(owner, { ...purchase, credits: 4990 }, 'qa-approved-starter');
    await payments.attachPaypalOrder(order.id, paypalOrderId);
    await payments.fulfill(order.id, capture);
    const priced = new PostgresBenefitStore(pool, true, 'sandbox', {
      'watermark-removal': 100, 'background-removal': 10, 'object-removal': 10,
    });
    await priced.reserve('qa-approved-free', owner, 'watermark-removal');
    await priced.consume('qa-approved-free', owner);
    await finance.grantCredits(owner, 77, 'qa-admin-allocation', 'admin:isolated-test');
    await Promise.all([
      finance.reserveAndEnqueue({ ...request, amount: 100 }),
      priced.reserve('qa-approved-background', owner, 'background-removal'),
      priced.reserve('qa-approved-object', owner, 'object-removal'),
    ]);
    await invariant(4870);
    await Promise.all([
      finance.refund(request.jobId, owner, 'qa-original-cost-return'),
      priced.consume('qa-approved-background', owner),
      priced.refund('qa-approved-object', owner),
    ]);
    await new PostgresBenefitStore(pool, true, 'sandbox', { 'background-removal': 999 }).reserve('qa-approved-background', owner, 'background-removal');
    await invariant(4980);
    const stored = await pool.query<{ amount: string }>('SELECT amount FROM job_credit_reservations WHERE job_id=$1', ['qa-approved-background']);
    expect(Number(stored.rows[0].amount)).toBe(10);
    await payments.applyAdjustment('refund:qa-approved-purchase', captureId, 'refund', 499);
    await priced.refund('qa-approved-object', owner);
    expect((await payments.getOrder(order.id))?.status).toBe('review');
    await invariant(0);
  }, 90_000);

  it('claim release waits for owner financial reservations and refuses to remove committed coordination', async () => {
    await baseline();
    const claims = new PostgresJobRequestStore(pool, 'sandbox');
    await claims.claim(createJob('qa-empty-claim', 'uploads/qa-empty.png', owner));
    await claims.releaseUnreservedRequest(owner, 'qa-empty-claim');
    expect(await claims.get('qa-empty-claim')).toBeNull();

    const jobId = 'qa-locked-claim';
    await claims.claim(createJob(jobId, 'uploads/qa-locked.png', owner));
    const blocker = await pool.connect();
    let transactionOpen = false;
    let releaseOutcome: Promise<{ released: boolean; error?: unknown }> | undefined;
    let resolveReleaserPid = (_pid: number) => {};
    const releaserPid = new Promise<number>((resolve) => { resolveReleaserPid = resolve; });
    const observedPool = {
      async connect() {
        const client = await pool.connect();
        try {
          await client.query("SET lock_timeout='25000ms'");
          const pid = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
          resolveReleaserPid(pid.rows[0].pid);
          return client;
        } catch (error) { client.release(); throw error; }
      },
    } as unknown as Pool;
    try {
      await blocker.query('BEGIN');
      transactionOpen = true;
      await blocker.query('SELECT user_id FROM user_benefits WHERE user_id=$1 FOR UPDATE', [owner]);
      const blockerPid = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      releaseOutcome = new PostgresJobRequestStore(observedPool, 'sandbox').releaseUnreservedRequest(owner, jobId)
        .then(() => ({ released: true }), (error: unknown) => ({ released: false, error }));
      const waiterPid = await Promise.race([
        releaserPid,
        releaseOutcome.then(() => { throw new Error('Claim release completed before its blocking connection was observed'); }),
      ]);
      let observedOwnerLock = false;
      const deadline = Date.now() + 10_000;
      do {
        const blocked = await pool.query<{ blockers: number[] }>('SELECT pg_blocking_pids($1) AS blockers', [waiterPid]);
        if (blocked.rows[0].blockers.includes(blockerPid)) { observedOwnerLock = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      } while (Date.now() < deadline);
      expect(observedOwnerLock).toBe(true);
      await reservePurchasedImageCredit(blocker, { jobId, ownerId: owner, environment: 'sandbox', amount: 1 });
      await blocker.query('COMMIT');
      transactionOpen = false;
      const outcome = await releaseOutcome;
      expect(outcome.released).toBe(false);
      expect(outcome.error).toMatchObject({ message: 'Financial request cannot be released' });
    } finally {
      if (transactionOpen) await blocker.query('ROLLBACK');
      blocker.release();
      if (releaseOutcome) await releaseOutcome;
    }
    expect((await claims.get(jobId))?.status).toBe('processing');
    expect((await pool.query<{ status: string }>('SELECT status FROM job_credit_reservations WHERE job_id=$1', [jobId])).rows[0].status).toBe('reserved');
    await invariant(4);
  }, 90_000);
});
