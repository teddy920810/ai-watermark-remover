import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresCreditWallet } from './postgres-credit-wallet';
import { applyCreditMigration, beginCreditMigration, previewCreditMigration } from './credit-migration';
import type { MigrationProof } from './credit-migration';
import { PostgresPaymentStore } from '../payments/postgres-payment-store';
import { PostgresBenefitStore } from '../benefits/postgres-benefit-store';
import { parseCreditMigrationArguments, runCreditMigration } from '../../../scripts/migrate-universal-credits.mjs';

const db = new PGlite();
let pending = Promise.resolve();
const pool = { query: (sql: string, params?: unknown[]) => db.query(sql, params), async connect() {
  const previous = pending; let release = () => {}; pending = new Promise<void>(resolve => { release = resolve; }); await previous;
  return { query: (sql: string, params?: unknown[]) => db.query(sql, params), release };
} } as unknown as Pool;
const wallet = new PostgresCreditWallet(pool, 'live');
const proof: MigrationProof = { ownerId: 'owner', environment: 'live', actor: 'admin:reviewer', reference: 'approved-batch', freeVerified: true, formalGrants: [] };
async function legacy() {
  await wallet.bootstrap('owner', undefined, false);
  await db.query("INSERT INTO google_user_profiles(google_subject,email,email_verified) VALUES('subject','owner@example.test',true)");
  await db.query("INSERT INTO google_account_owners(google_subject,owner_id,verified_email) VALUES('subject','owner','owner@example.test')");
}
beforeAll(async () => { for (const file of (await readdir('db/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await readFile(`db/migrations/${file}`, 'utf8')); }, 30_000);
beforeEach(async () => { await db.exec('TRUNCATE user_benefits,processing_accounts,processing_admissions,processing_outbox,payment_orders,payment_events,payment_adjustments,google_user_profiles CASCADE'); });
afterAll(async () => { await db.close(); });

describe('audited per-owner Credits cutover', () => {
  it('converts the remaining original purchase once, preserves history and freezes it on a later refund', async () => {
    await legacy();
    const payments = new PostgresPaymentStore(pool, 'live');
    const order = await payments.createOrder('owner', { sku: 'original', credits: 50, amountCents: 499, currency: 'USD', catalogVersion: 'original' }, 'original');
    await payments.attachPaypalOrder(order.id, 'PAYPAL1');
    const capture = { id: 'CAPTURE1', paypalOrderId: 'PAYPAL1', amountCents: 499, currency: 'USD' as const, merchantId: 'MERCHANT1' };
    await payments.fulfill(order.id, capture);
    await beginCreditMigration(pool, proof); const plan = await previewCreditMigration(pool, proof);
    expect(plan).toMatchObject({ eligible: true, credits: 150 });
    await applyCreditMigration(pool, proof, plan.digest); await payments.fulfill(order.id, capture);
    expect(await wallet.summary('owner')).toMatchObject({ credits: 150 });
    expect(await payments.getOrder(order.id)).toMatchObject({ credits: 50, amountCents: 499, captureId: 'CAPTURE1', catalogVersion: 'original' });
    await payments.applyAdjustment('refund-original', capture.id, 'refund', 499);
    expect(await wallet.summary('owner')).toMatchObject({ credits: 100 });
    expect((await db.query("SELECT delta FROM paid_credit_ledger WHERE reason='purchase'")).rows).toEqual([{ delta: 50 }]);
  });
  it('does not issue a second daily reward after converting today’s legacy check-in', async () => {
    await legacy(); await new PostgresBenefitStore(pool).checkIn('owner');
    await beginCreditMigration(pool, proof); const plan = await previewCreditMigration(pool, proof);
    await applyCreditMigration(pool, proof, plan.digest);
    expect(await wallet.checkIn('owner')).toMatchObject({ credits: 200, granted: 0, checkedInToday: true });
  });
  it('refuses a purchase whose original capture evidence or source ledger is inconsistent', async () => {
    await legacy(); const payments = new PostgresPaymentStore(pool, 'live');
    const order = await payments.createOrder('owner', { sku: 'original', credits: 50, amountCents: 499, currency: 'USD', catalogVersion: 'original' }, 'original');
    await payments.attachPaypalOrder(order.id, 'PAYPAL1');
    await payments.fulfill(order.id, { id: 'CAPTURE1', paypalOrderId: 'PAYPAL1', amountCents: 499, currency: 'USD', merchantId: 'MERCHANT1' });
    await db.query('UPDATE paid_credit_lots SET available=49 WHERE order_id=$1', [order.id]);
    expect(await previewCreditMigration(pool, proof)).toMatchObject({ eligible: false, reasons: expect.arrayContaining(['purchase_ledger_mismatch']) });
    await db.query('UPDATE paid_credit_lots SET available=50 WHERE order_id=$1', [order.id]);
    await db.query('UPDATE payment_orders SET capture_id=NULL WHERE id=$1', [order.id]);
    expect(await previewCreditMigration(pool, proof)).toMatchObject({ eligible: false, reasons: expect.arrayContaining(['purchase_needs_review']) });
  });
  it('records revised source proof after a legacy refund drains, and rejects the old reviewed digest', async () => {
    await legacy();
    await db.query("INSERT INTO processing_accounts(owner_id,available_credits) VALUES('owner',1)");
    const grant = await db.query<{ id: number }>("INSERT INTO processing_credit_ledger(owner_id,delta,balance_after,reason,reference_id,actor_id) VALUES('owner',2,2,'grant','drain-refund','admin:original') RETURNING id");
    await db.query("INSERT INTO processing_credit_ledger(owner_id,delta,balance_after,reason,reference_id) VALUES('owner',-1,1,'reserve','held')");
    const initial = { ...proof, formalGrants: [{ ledgerId: String(grant.rows[0].id), available: 1, verified: true }] };
    await beginCreditMigration(pool, initial);
    const stale = await previewCreditMigration(pool, initial);
    await db.query("UPDATE processing_accounts SET available_credits=2 WHERE owner_id='owner'");
    await db.query("INSERT INTO processing_credit_ledger(owner_id,delta,balance_after,reason,reference_id) VALUES('owner',1,2,'refund','held')");
    const revised = { ...initial, formalGrants: [{ ...initial.formalGrants[0], available: 2 }] };
    await expect(beginCreditMigration(pool, revised)).resolves.toMatchObject({ phase: 'draining', epoch: 1 });
    await expect(applyCreditMigration(pool, initial, stale.digest)).rejects.toMatchObject({ code: 'migration_conflict' });
    const fresh = await previewCreditMigration(pool, revised);
    expect(await applyCreditMigration(pool, revised, fresh.digest)).toMatchObject({ credits: 300 });
    const history = (await db.query<{ proof_history: unknown[] }>('SELECT proof_history FROM credit_migration_runs')).rows[0].proof_history;
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ proof: initial });
    expect(history[1]).toMatchObject({ proof: revised });
  });
  it('keeps the CLI import-safe, preview-only by default and free of a DATABASE_URL fallback', async () => {
    const args = ['--owner', 'owner', '--environment', 'live', '--proof', 'reviewed.json', '--actor', proof.actor, '--reference', proof.reference];
    expect(parseCreditMigrationArguments(args)).toMatchObject({ action: 'preview', apply: false, databaseEnv: 'CREDITS_MIGRATION_DATABASE_URL' });
    expect(() => parseCreditMigrationArguments([...args, '--action', 'apply', '--expected-digest', 'a'.repeat(64)])).toThrow();
    expect(() => parseCreditMigrationArguments([...args, '--db-env', 'DATABASE_URL'])).toThrow();
    await legacy();
    const result = await runCreditMigration(parseCreditMigrationArguments(args), { pool, readProof: async () => proof,
      migration: { previewCreditMigration, beginCreditMigration, applyCreditMigration } });
    expect(result).toMatchObject({ eligible: true, phase: 'legacy', credits: 100 });
    expect((await wallet.summary('owner')).phase).toBe('legacy');
  });
  it('previews without mutation, converts once, and preserves the old free-use issuance history', async () => {
    await legacy();
    const before = await previewCreditMigration(pool, proof);
    expect(before).toMatchObject({ eligible: true, phase: 'legacy', credits: 100 });
    expect((await wallet.summary('owner')).phase).toBe('legacy');
    await expect(applyCreditMigration(pool, proof, before.digest)).rejects.toMatchObject({ code: 'migration_not_draining' });
    await beginCreditMigration(pool, proof);
    const plan = await previewCreditMigration(pool, proof);
    expect(await applyCreditMigration(pool, proof, plan.digest)).toMatchObject({ phase: 'unified', credits: 100 });
    expect(await applyCreditMigration(pool, proof, plan.digest)).toMatchObject({ phase: 'unified', credits: 100 });
    expect((await db.query('SELECT balance FROM user_benefits WHERE user_id=$1', ['owner'])).rows).toEqual([{ balance: 0 }]);
    expect((await db.query("SELECT delta FROM benefit_ledger WHERE reason='first_use'")).rows).toEqual([{ delta: 1 }]);
    expect((await db.query('SELECT * FROM credit_source_conversions')).rows).toHaveLength(2);
  });
  it('refuses a stale preview, held old allowance, or incomplete source evidence', async () => {
    await legacy(); await beginCreditMigration(pool, proof);
    const plan = await previewCreditMigration(pool, proof);
    await db.query("INSERT INTO job_credit_reservations(job_id,user_id,status) VALUES('inflight','owner','reserved')");
    expect(await previewCreditMigration(pool, proof)).toMatchObject({ eligible: false, reasons: expect.arrayContaining(['inflight_legacy']) });
    await expect(applyCreditMigration(pool, proof, plan.digest)).rejects.toMatchObject({ code: 'migration_changed' });
    expect((await wallet.summary('owner')).phase).toBe('draining');
    await db.query("DELETE FROM job_credit_reservations WHERE job_id='inflight'");
    expect(await previewCreditMigration(pool, { ...proof, freeVerified: false })).toMatchObject({ eligible: false, reasons: expect.arrayContaining(['free_source_unverified']) });
  });
  it('keeps processing credits deferred unless every remaining unit is bound to a verified original grant', async () => {
    await legacy();
    await db.query("INSERT INTO processing_accounts(owner_id,available_credits) VALUES('owner',2)");
    const grant = await db.query<{ id: number }>("INSERT INTO processing_credit_ledger(owner_id,delta,balance_after,reason,reference_id,actor_id) VALUES('owner',2,2,'grant','formal','admin:original') RETURNING id");
    expect(await previewCreditMigration(pool, proof)).toMatchObject({ eligible: false, reasons: expect.arrayContaining(['processing_source_unverified']) });
    const verified = { ...proof, formalGrants: [{ ledgerId: String(grant.rows[0].id), available: 2, verified: true }] };
    await beginCreditMigration(pool, verified);
    const plan = await previewCreditMigration(pool, verified);
    expect(plan).toMatchObject({ eligible: true, credits: 300 });
    await applyCreditMigration(pool, verified, plan.digest);
    expect(await wallet.revoke('owner', { amount: 200, grantReference: 'formal', reference: 'revoke-original', actor: 'admin:reviewer' })).toMatchObject({ balance: 100 });
  });
  it('does not clip owned free uses exceeding the reward issuance cap or grant another signup reward', async () => {
    await legacy();
    await db.query("UPDATE user_benefits SET balance=4 WHERE user_id='owner'");
    for (let index = 1; index <= 3; index++) await db.query("INSERT INTO benefit_ledger(user_id,delta,balance_after,reason,reference_id) VALUES('owner',1,$1,'job_refund',$2)", [1 + index, `historic-${index}`]);
    await beginCreditMigration(pool, proof);
    const plan = await previewCreditMigration(pool, proof);
    await applyCreditMigration(pool, proof, plan.digest);
    expect(await wallet.bootstrap('owner', undefined, true)).toMatchObject({ credits: 400 });
    expect(await wallet.checkIn('owner')).toMatchObject({ credits: 400, granted: 0 });
  });
  it('does not convert the same global legacy source into a second environment', async () => {
    await legacy(); await beginCreditMigration(pool, proof);
    const plan = await previewCreditMigration(pool, proof); await applyCreditMigration(pool, proof, plan.digest);
    const sandbox = { ...proof, environment: 'sandbox' as const };
    expect(await previewCreditMigration(pool, sandbox)).toMatchObject({ eligible: false, reasons: expect.arrayContaining(['source_already_converted']) });
    expect(await new PostgresCreditWallet(pool, 'sandbox').summary('owner')).toMatchObject({ credits: 0 });
    await expect(wallet.transaction(client => new PostgresCreditWallet(pool, 'sandbox').assertLegacy(client, 'owner'))).rejects.toMatchObject({ code: 'wallet_upgraded' });
  });
});
