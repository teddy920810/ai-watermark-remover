import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { ProcessingError } from '../processing/contracts';
import { creditInteger, creditPolicy } from './credit-policy';
import type { CreditEnvironment, WalletState } from './credit-policy';
import { PostgresCreditWallet, readCreditWalletState } from './postgres-credit-wallet';

/** Operator-reviewed source allocation, not an inference from the total balance. */
export interface MigrationProof {
  ownerId: string; environment: CreditEnvironment; actor: string; reference: string; freeVerified: boolean;
  formalGrants: { ledgerId: string; available: number; verified: boolean }[];
}
interface Grant { id: string; reference_id: string; actor_id: string | null; delta: string }
interface Purchase { id: string; order_id: string; user_id: string; available: number; granted: number; status: string; environment: CreditEnvironment; order_status: string; catalog_version: string; capture_id: string | null; order_credits: number; ledger_total: string; last_ledger_id: string }
export interface MigrationSnapshot extends WalletState {
  ownerId: string; identityVerified: boolean; freeUses: number; processingCredits: number;
  freeLedger: { total: string; last_id: string }; processingLedger: { total: string; last_id: string };
  pending: number; grants: Grant[]; purchases: Purchase[]; convertedSources: { source_type: string; source_id: string; environment: string; digest: string }[];
  day: string; checkedInToday: boolean;
}
export interface CreditMigrationPlan {
  version: string; ownerId: string; environment: CreditEnvironment; phase: WalletState['phase'];
  credits: number; eligible: boolean; reasons: string[]; digest: string; snapshot: MigrationSnapshot; proof: MigrationProof;
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function validateProof(proof: MigrationProof) {
  if (!proof || !proof.ownerId || proof.ownerId.length > 512 || !['live','sandbox'].includes(proof.environment)
    || !proof.actor?.trim() || proof.actor.length > 160 || !/^[a-zA-Z0-9:_-]{1,160}$/.test(proof.reference) || typeof proof.freeVerified !== 'boolean'
    || !Array.isArray(proof.formalGrants)) throw new Error('Explicit owner, environment, actor and reviewed source proof are required');
  const seen = new Set<string>();
  for (const grant of proof.formalGrants) {
    if (!/^\d+$/.test(grant.ledgerId) || seen.has(grant.ledgerId) || typeof grant.verified !== 'boolean') throw new Error('Grant source proof must be unique and explicit');
    seen.add(grant.ledgerId); creditInteger(grant.available);
  }
}
/** Pure: it neither reads an account nor connects to a database. */
export function planCreditMigration(snapshot: MigrationSnapshot, proof: MigrationProof): CreditMigrationPlan {
  validateProof(proof);
  if (snapshot.ownerId !== proof.ownerId || snapshot.environment !== proof.environment) throw new Error('Source proof belongs to another account or environment');
  const reasons: string[] = [];
  const free = creditInteger(snapshot.freeUses); const processing = creditInteger(snapshot.processingCredits);
  if (!snapshot.identityVerified) reasons.push('identity_unverified');
  if (snapshot.phase === 'unified') reasons.push('already_unified');
  if (snapshot.pending) reasons.push('inflight_legacy');
  if (!proof.freeVerified) reasons.push('free_source_unverified');
  if (creditInteger(snapshot.freeLedger.total) !== free || creditInteger(snapshot.processingLedger.total) !== processing) reasons.push('ledger_mismatch');
  if (snapshot.convertedSources.length) reasons.push('source_already_converted');
  let formal = 0;
  for (const source of proof.formalGrants) {
    const grant = snapshot.grants.find(row => row.id === source.ledgerId);
    if (!source.verified || !grant?.actor_id?.trim() || source.available > creditInteger(grant.delta)) reasons.push('processing_source_unverified');
    formal += source.available; creditInteger(formal);
  }
  if (formal !== processing) reasons.push('processing_source_unverified');
  let purchased = 0;
  for (const lot of snapshot.purchases) {
    if (lot.user_id !== proof.ownerId || lot.environment !== proof.environment) reasons.push('purchase_owner_environment');
    if (!lot.capture_id || !lot.catalog_version?.trim() || lot.order_credits !== lot.granted || creditInteger(lot.available) > creditInteger(lot.granted, true)
      || lot.order_status === 'review' || lot.order_status === 'created' || (lot.status !== 'active' && creditInteger(lot.available) > 0)) reasons.push('purchase_needs_review');
    if (creditInteger(lot.ledger_total) !== creditInteger(lot.available)) reasons.push('purchase_ledger_mismatch');
    if (lot.status === 'active' && lot.order_status === 'fulfilled') purchased += creditInteger(lot.available);
    creditInteger(purchased);
  }
  const credits = creditInteger(free * creditPolicy.conversion.freeUse + formal * creditPolicy.conversion.formalProcessing + purchased * creditPolicy.conversion.purchase);
  const body = { version: creditPolicy.version, snapshot, proof };
  return { version: creditPolicy.version, ownerId: proof.ownerId, environment: proof.environment, phase: snapshot.phase, credits,
    eligible: reasons.length === 0, reasons: [...new Set(reasons)], digest: hash(body), snapshot, proof };
}
async function snapshot(client: PoolClient, proof: MigrationProof): Promise<MigrationSnapshot> {
  const { ownerId: owner, environment } = proof;
  const state = await readCreditWalletState(client, owner, environment);
  const user = (await client.query<{ balance: number }>('SELECT balance FROM user_benefits WHERE user_id=$1', [owner])).rows[0];
  if (!user) throw new ProcessingError('migration_owner_missing', 'The existing account was not found', 404);
  const identity = (await client.query<{ verified: boolean }>(`SELECT EXISTS(SELECT 1 FROM google_account_owners o
    JOIN google_user_profiles p ON p.google_subject=o.google_subject WHERE o.owner_id=$1 AND p.email_verified=TRUE
      AND LOWER(p.email)=LOWER(o.verified_email)) AS verified`, [owner])).rows[0].verified;
  const processing = (await client.query<{ available_credits: string }>('SELECT available_credits FROM processing_accounts WHERE owner_id=$1', [owner])).rows[0];
  const freeLedger = (await client.query<{ total: string; last_id: string }>('SELECT COALESCE(SUM(delta),0)::text AS total,COALESCE(MAX(id),0)::text AS last_id FROM benefit_ledger WHERE user_id=$1', [owner])).rows[0];
  const processingLedger = (await client.query<{ total: string; last_id: string }>('SELECT COALESCE(SUM(delta),0)::text AS total,COALESCE(MAX(id),0)::text AS last_id FROM processing_credit_ledger WHERE owner_id=$1', [owner])).rows[0];
  const pending = (await client.query<{ pending: string }>(`SELECT (
    (SELECT COUNT(*) FROM processing_admissions WHERE owner_id=$1 AND status='reserved') +
    (SELECT COUNT(*) FROM job_credit_reservations WHERE user_id=$1 AND status='reserved') +
    (SELECT COUNT(*) FROM processing_requests WHERE owner_id=$1 AND status='processing'))::text AS pending`, [owner])).rows[0].pending;
  const grants = (await client.query<Grant>("SELECT id::text,reference_id,actor_id,delta::text FROM processing_credit_ledger WHERE owner_id=$1 AND reason='grant' ORDER BY id", [owner])).rows;
  const purchases = (await client.query<Purchase>(`SELECT l.id,l.order_id,l.user_id,l.available,l.granted,l.status,o.environment,o.status AS order_status,o.catalog_version,o.capture_id,o.credits AS order_credits,
    (SELECT COALESCE(SUM(delta),0)::text FROM paid_credit_ledger WHERE lot_id=l.id) AS ledger_total,
    (SELECT COALESCE(MAX(id),0)::text FROM paid_credit_ledger WHERE lot_id=l.id) AS last_ledger_id
    FROM paid_credit_lots l JOIN payment_orders o ON o.id=l.order_id WHERE l.user_id=$1 AND o.environment=$2 ORDER BY l.id`, [owner, environment])).rows;
  const convertedSources = (await client.query<MigrationSnapshot['convertedSources'][number]>('SELECT source_type,source_id,environment,digest FROM credit_source_conversions WHERE owner_id=$1 ORDER BY source_type,source_id', [owner])).rows;
  const today = (await client.query<{ day: string; checked: boolean }>(`SELECT (NOW() AT TIME ZONE 'UTC')::date::text AS day,
    EXISTS(SELECT 1 FROM daily_checkins WHERE user_id=$1 AND checkin_date=(NOW() AT TIME ZONE 'UTC')::date) AS checked`, [owner])).rows[0];
  return { ...state, ownerId: owner, identityVerified: identity, freeUses: creditInteger(user.balance), processingCredits: creditInteger(processing?.available_credits ?? 0),
    freeLedger, processingLedger, pending: creditInteger(pending), grants, purchases, convertedSources, day: today.day, checkedInToday: today.checked };
}
/** A real-account read when invoked with a real pool; never invoked on import. */
export async function previewCreditMigration(pool: Pool, proof: MigrationProof): Promise<CreditMigrationPlan> {
  validateProof(proof);
  const client = await pool.connect();
  try { await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); const result = planCreditMigration(await snapshot(client, proof), proof); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
export async function beginCreditMigration(pool: Pool, proof: MigrationProof): Promise<WalletState> {
  validateProof(proof); const wallet = new PostgresCreditWallet(pool, proof.environment);
  return wallet.transaction(async client => {
    await wallet.lockOwner(client, proof.ownerId);
    const state = await wallet.state(client, proof.ownerId);
    if (state.phase === 'unified') throw new ProcessingError('migration_already_unified', 'The account is already unified', 409);
    const run = (await client.query<{ actor_id: string; reference_id: string; proof_digest: string }>('SELECT * FROM credit_migration_runs WHERE owner_id=$1 AND environment=$2', [proof.ownerId, proof.environment])).rows[0];
    if (run && (run.actor_id !== proof.actor || run.reference_id !== proof.reference)) throw new ProcessingError('migration_conflict', 'The draining account belongs to a different reviewed batch', 409);
    if (state.phase === 'legacy') {
      await client.query(`INSERT INTO credit_accounts(owner_id,environment,phase,epoch) VALUES($1,$2,'draining',1)
        ON CONFLICT(owner_id,environment) DO UPDATE SET phase='draining',epoch=credit_accounts.epoch+1,updated_at=NOW()`, [proof.ownerId, proof.environment]);
      await client.query("INSERT INTO credit_migration_runs(owner_id,environment,phase,actor_id,reference_id,rule_version,proof_digest,proof_history) VALUES($1,$2,'draining',$3,$4,$5,$6,$7::jsonb)", [proof.ownerId, proof.environment, proof.actor, proof.reference, creditPolicy.version, hash(proof), JSON.stringify([{ digest: hash(proof), proof }])]);
    } else if (run && run.proof_digest !== hash(proof)) {
      // An explicit repeated drain records new reviewed evidence after old tasks finish.
      // Keep the original audit record; the final apply accepts only the latest proof.
      await client.query('UPDATE credit_migration_runs SET proof_digest=$3,proof_history=proof_history || $4::jsonb WHERE owner_id=$1 AND environment=$2',
        [proof.ownerId, proof.environment, hash(proof), JSON.stringify([{ digest: hash(proof), proof }])]);
    }
    return wallet.state(client, proof.ownerId);
  });
}
/** Requires its exact reviewed post-drain digest; all legacy debits and new lots commit together. */
export async function applyCreditMigration(pool: Pool, proof: MigrationProof, expectedDigest: string) {
  validateProof(proof);
  if (!/^[a-f0-9]{64}$/.test(expectedDigest)) throw new Error('The reviewed snapshot digest is required');
  const wallet = new PostgresCreditWallet(pool, proof.environment);
  return wallet.transaction(async client => {
    const owner = proof.ownerId; const env = proof.environment;
    await wallet.lockOwner(client, owner);
    const run = (await client.query<{ phase: string; digest: string | null; actor_id: string; reference_id: string; proof_digest: string }>('SELECT * FROM credit_migration_runs WHERE owner_id=$1 AND environment=$2 FOR UPDATE', [owner, env])).rows[0];
    if (run && (run.actor_id !== proof.actor || run.reference_id !== proof.reference || run.proof_digest !== hash(proof))) throw new ProcessingError('migration_conflict', 'Migration source proof differs from the reviewed batch', 409);
    if (run?.phase === 'unified') {
      if (run.digest !== expectedDigest) throw new ProcessingError('migration_conflict', 'The completed migration belongs to another snapshot', 409);
      return wallet.summary(owner, client);
    }
    if ((await wallet.state(client, owner)).phase !== 'draining' || !run) throw new ProcessingError('migration_not_draining', 'Drain the account and review a fresh preview first', 409);
    const plan = planCreditMigration(await snapshot(client, proof), proof);
    if (plan.digest !== expectedDigest) throw new ProcessingError('migration_changed', 'Account evidence changed; review a new preview', 409);
    if (!plan.eligible) throw new ProcessingError('migration_blocked', `Account requires review: ${plan.reasons.join(', ')}`, 409);
    const current = plan.snapshot;
    const convert = async (type: string, id: string, oldAmount: number, newAmount: number, lotId?: string) => {
      await client.query(`INSERT INTO credit_source_conversions(source_type,source_id,owner_id,environment,lot_id,old_amount,new_amount,rule_version,digest)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [type, id, owner, env, lotId ?? null, oldAmount, newAmount, creditPolicy.version, expectedDigest]);
    };
    const freeCredits = creditInteger(current.freeUses * creditPolicy.conversion.freeUse);
    const freeLot = freeCredits ? await wallet.addLot(client, owner, { kind: 'reward', sourceId: `legacy-free:${owner}`, originType: 'legacy_free', originId: owner,
      amount: freeCredits, reason: 'migration_in', reference: proof.reference }) : undefined;
    await convert('free', owner, current.freeUses, freeCredits, freeLot);
    // Zero-quantity fence closes the shared old processing bucket even if empty.
    await convert('processing', `account:${owner}`, 0, 0);
    for (const item of proof.formalGrants) {
      const grant = current.grants.find(row => row.id === item.ledgerId)!;
      const amount = creditInteger(item.available * creditPolicy.conversion.formalProcessing);
      const lot = amount ? await wallet.addLot(client, owner, { kind: 'admin', sourceId: grant.reference_id, originType: 'legacy_processing_grant', originId: grant.id,
        actor: grant.actor_id!, amount, reason: 'migration_in', reference: proof.reference }) : undefined;
      await convert('processing', `grant:${grant.id}`, item.available, amount, lot);
    }
    for (const original of current.purchases) {
      const amount = original.status === 'active' && original.order_status === 'fulfilled' ? creditInteger(original.available) : 0;
      const lot = amount ? await wallet.addLot(client, owner, { kind: 'purchase', sourceId: original.order_id, originType: 'legacy_purchase', originId: original.id,
        amount, reason: 'migration_in', reference: proof.reference }) : undefined;
      await convert('purchase', original.id, creditInteger(original.available), amount, lot);
      if (original.available) {
        await client.query('UPDATE paid_credit_lots SET available=0 WHERE id=$1', [original.id]);
        await client.query("INSERT INTO paid_credit_ledger(user_id,lot_id,delta,balance_after,reason,reference_id) VALUES($1,$2,$3,0,'migration_out',$4)", [owner, original.id, -original.available, proof.reference]);
      }
    }
    if (current.freeUses) {
      await client.query('UPDATE user_benefits SET balance=0 WHERE user_id=$1', [owner]);
      await client.query("INSERT INTO benefit_ledger(user_id,delta,balance_after,reason,reference_id) VALUES($1,$2,0,'migration_out',$3)", [owner, -current.freeUses, proof.reference]);
    }
    if (current.processingCredits) {
      await client.query('UPDATE processing_accounts SET available_credits=0,updated_at=NOW() WHERE owner_id=$1', [owner]);
      await client.query("INSERT INTO processing_credit_ledger(owner_id,delta,balance_after,reason,reference_id,actor_id) VALUES($1,$2,0,'migration_out',$3,$4)", [owner, -current.processingCredits, proof.reference, proof.actor]);
    }
    if (current.checkedInToday) await client.query('INSERT INTO credit_checkins(owner_id,environment,day,amount) VALUES($1,$2,$3,100) ON CONFLICT DO NOTHING', [owner, env, current.day]);
    await client.query("UPDATE credit_accounts SET phase='unified',epoch=epoch+1,updated_at=NOW() WHERE owner_id=$1 AND environment=$2", [owner, env]);
    await client.query("UPDATE credit_migration_runs SET phase='unified',digest=$3,snapshot=$4::jsonb WHERE owner_id=$1 AND environment=$2", [owner, env, expectedDigest, JSON.stringify(plan)]);
    const result = await wallet.summary(owner, client);
    if (result.credits !== plan.credits) throw new Error('Migration conservation check failed');
    return result;
  });
}
