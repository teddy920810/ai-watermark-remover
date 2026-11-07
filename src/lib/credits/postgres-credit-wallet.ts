import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { ensureFreeBenefitAccount, lockFinancialOwner } from '../benefits/free-benefits';
import { ProcessingError } from '../processing/contracts';
import { creditInteger, creditPolicy, rewardAmount } from './credit-policy';
import type { CreditEnvironment, WalletState } from './credit-policy';

type Client = Pick<PoolClient, 'query'>;
type Kind = 'reward' | 'admin' | 'purchase';
type Status = 'reserved' | 'settled' | 'refunded';
interface Lot { id: string; owner_id: string; environment: CreditEnvironment; kind: Kind; source_id: string; origin_type: string; origin_id: string; actor_id: string | null; granted: string; available: string; status: 'active' | 'frozen' }
interface Reservation { owner_id: string; environment: CreditEnvironment; amount: string; wallet_epoch: string; status: Status }
interface Allocation extends Lot { amount: string }
export interface CreditSummary extends WalletState { credits: number; rewardAvailable: number; rewardReserved: number; checkedInToday: boolean }
export interface AdminGrant { amount: number; reference: string; actor: string }
export interface AdminRevoke extends AdminGrant { grantReference: string }
export interface NewCreditLot { kind: Kind; sourceId: string; originType: string; originId: string; amount: number; actor?: string; reason: 'grant' | 'reward' | 'purchase' | 'migration_in'; reference: string }
function fail(code: string, message: string, status = 409): never { throw new ProcessingError(code, message, status); }
function audit(reference: string, actor: string) {
  if (!/^[a-zA-Z0-9:_-]{1,160}$/.test(reference) || !actor?.trim() || actor.length > 160) fail('invalid_adjustment', 'An explicit source, actor and audit reference are required');
}
export async function readCreditWalletState(client: Client, owner: string, environment: CreditEnvironment): Promise<WalletState> {
  const row = (await client.query<{ phase: string; epoch: string }>('SELECT phase,epoch FROM credit_accounts WHERE owner_id=$1 AND environment=$2', [owner, environment])).rows[0];
  if (!row) return { phase: 'legacy', epoch: 0, environment };
  if (!['legacy', 'draining', 'unified'].includes(row.phase)) fail('wallet_unavailable', 'Unknown account currency state', 503);
  return { phase: row.phase as WalletState['phase'], epoch: creditInteger(row.epoch), environment };
}
export async function assertLegacyCreditAdmission(client: Client, owner: string, environment: CreditEnvironment, allowDraining = false) {
  const state = await readCreditWalletState(client, owner, environment);
  if (state.phase === 'unified' || state.phase === 'draining' && !allowDraining) fail('wallet_upgraded', 'Open the current workspace to confirm a new Credits quote');
  const converted = await client.query("SELECT 1 FROM credit_source_conversions WHERE owner_id=$1 AND source_type IN ('free','processing') LIMIT 1", [owner]);
  if (converted.rows[0]) fail('wallet_upgraded', 'The legacy account source has already been converted');
}

/** All writers lock the existing owner before account/reservation/lot rows.
 * Payment callers may hold capture/order locks first; this wallet never locks orders.
 * Methods accepting a client never connect or commit and must share the caller's transaction.
 */
export class PostgresCreditWallet {
  constructor(private readonly pool: Pool, readonly environment: CreditEnvironment, private readonly now: () => Date = () => new Date()) {
    if (!['sandbox', 'live'].includes(environment)) throw new Error('An explicit credit environment is required');
  }
  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const value = await work(client); await client.query('COMMIT'); return value; }
    catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async lockOwner(client: Client, owner: string): Promise<void> {
    if (!owner || owner.length > 512) fail('invalid_owner', 'An account owner is required');
    await lockFinancialOwner(client, owner);
    const row = await client.query('SELECT user_id FROM user_benefits WHERE user_id=$1 FOR UPDATE', [owner]);
    if (!row.rows[0]) fail('wallet_unavailable', 'Initialize the account before using Credits', 503);
  }
  async state(client: Client, owner: string): Promise<WalletState> {
    return readCreditWalletState(client, owner, this.environment);
  }
  async requireUnified(client: Client, owner: string, epoch?: number) {
    const state = await this.state(client, owner);
    if (state.phase !== 'unified') fail('wallet_not_unified', 'This account is not ready for the new currency');
    if (epoch !== undefined && state.epoch !== epoch) fail('quote_changed', 'Confirm a quote for the current account');
    return state;
  }
  async assertLegacy(client: Client, owner: string, allowDraining = false) {
    await assertLegacyCreditAdmission(client, owner, this.environment, allowDraining);
  }
  async bootstrap(owner: string, email?: string, enableNewAccounts = false): Promise<CreditSummary> {
    return this.transaction(async client => {
      const created = await ensureFreeBenefitAccount(client, owner, { email, initialFreeUses: enableNewAccounts ? 0 : 1 });
      await this.lockOwner(client, owner);
      const phase = created && enableNewAccounts ? 'unified' : 'legacy';
      const inserted = await client.query(`INSERT INTO credit_accounts(owner_id,environment,phase,epoch) VALUES($1,$2,$3,$4)
        ON CONFLICT(owner_id,environment) DO NOTHING RETURNING owner_id`, [owner, this.environment, phase, phase === 'unified' ? 1 : 0]);
      if (inserted.rows[0] && phase === 'unified') await this.addLot(client, owner, { kind: 'reward', sourceId: 'first', originType: 'first_reward', originId: owner,
        amount: creditPolicy.rewards.first, reason: 'reward', reference: 'first' });
      return this.summary(owner, client);
    });
  }
  async summary(owner: string, client: Client = this.pool): Promise<CreditSummary> {
    const state = await this.state(client, owner);
    const result = await client.query<{ credits: string; reward_available: string; reward_reserved: string; checked_in: boolean }>(`
      SELECT COALESCE(SUM(l.available) FILTER(WHERE l.status='active'),0)::text AS credits,
        COALESCE(SUM(l.available) FILTER(WHERE l.kind='reward' AND l.status='active'),0)::text AS reward_available,
        (SELECT COALESCE(SUM(a.amount),0)::text FROM credit_allocations a
          JOIN credit_reservations r ON r.job_id=a.job_id JOIN credit_lots rl ON rl.id=a.lot_id
          WHERE r.owner_id=$1 AND r.environment=$2 AND r.status='reserved' AND rl.kind='reward') AS reward_reserved,
        EXISTS(SELECT 1 FROM credit_checkins WHERE owner_id=$1 AND environment=$2 AND day=$3::date) AS checked_in
      FROM credit_lots l WHERE l.owner_id=$1 AND l.environment=$2`, [owner, this.environment, this.today()]);
    const row = result.rows[0];
    return { ...state, credits: creditInteger(row.credits), rewardAvailable: creditInteger(row.reward_available), rewardReserved: creditInteger(row.reward_reserved), checkedInToday: row.checked_in };
  }
  async addLot(client: Client, owner: string, input: NewCreditLot): Promise<string> {
    await this.lockOwner(client, owner);
    const amount = creditInteger(input.amount, true);
    if (!input.sourceId || !input.originId || (input.kind === 'admin' && !input.actor?.trim())) fail('invalid_source', 'A traceable credit source is required');
    const existing = await client.query<Lot>('SELECT * FROM credit_lots WHERE owner_id=$1 AND environment=$2 AND kind=$3 AND source_id=$4', [owner, this.environment, input.kind, input.sourceId]);
    const prior = existing.rows[0];
    if (prior) {
      if (creditInteger(prior.granted) !== amount || prior.origin_type !== input.originType || prior.origin_id !== input.originId || prior.actor_id !== (input.actor ?? null)) fail('source_conflict', 'Credit source belongs to a different issuance');
      return prior.id;
    }
    creditInteger((await this.summary(owner, client)).credits + amount);
    const id = randomUUID();
    await client.query(`INSERT INTO credit_lots(id,owner_id,environment,kind,source_id,origin_type,origin_id,actor_id,granted,available)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`, [id, owner, this.environment, input.kind, input.sourceId, input.originType, input.originId, input.actor ?? null, amount]);
    await this.ledger(client, owner, id, amount, amount, input.reason, input.reference, input.actor);
    return id;
  }
  async checkIn(owner: string, existingClient?: PoolClient): Promise<CreditSummary & { granted: number }> {
    const work = async (client: PoolClient) => {
      await this.lockOwner(client, owner); await this.requireUnified(client, owner);
      const summary = await this.summary(owner, client);
      const amount = summary.checkedInToday ? 0 : rewardAmount(summary.rewardAvailable, summary.rewardReserved);
      if (amount) {
        const day = this.today();
        await client.query('INSERT INTO credit_checkins(owner_id,environment,day,amount) VALUES($1,$2,$3,$4)', [owner, this.environment, day, amount]);
        await this.addLot(client, owner, { kind: 'reward', sourceId: `checkin:${day}`, originType: 'daily_reward', originId: day, amount, reason: 'reward', reference: day });
      }
      return { ...await this.summary(owner, client), granted: amount };
    };
    return existingClient ? work(existingClient) : this.transaction(work);
  }
  async grant(owner: string, input: AdminGrant) {
    audit(input.reference, input.actor); creditInteger(input.amount, true);
    return this.transaction(async client => {
      await this.lockOwner(client, owner); await this.requireUnified(client, owner);
      const prior = await this.action(client, owner, 'grant', input.reference);
      if (prior) {
        if (creditInteger(prior.amount) !== input.amount || prior.actor_id !== input.actor) fail('adjustment_conflict', 'Grant reference conflicts with its original request');
        return { changed: false, lotId: prior.lot_id, balance: (await this.summary(owner, client)).credits };
      }
      const lotId = await this.addLot(client, owner, { kind: 'admin', sourceId: input.reference, originType: 'admin_grant', originId: input.reference, actor: input.actor, amount: input.amount, reason: 'grant', reference: input.reference });
      await this.recordAction(client, owner, 'grant', input, lotId);
      return { changed: true, lotId, balance: (await this.summary(owner, client)).credits };
    });
  }
  async revoke(owner: string, input: AdminRevoke) {
    audit(input.reference, input.actor); creditInteger(input.amount, true);
    if (!input.grantReference) fail('invalid_source', 'The original grant reference is required');
    return this.transaction(async client => {
      await this.lockOwner(client, owner); await this.requireUnified(client, owner);
      const lot = (await client.query<Lot>("SELECT * FROM credit_lots WHERE owner_id=$1 AND environment=$2 AND kind='admin' AND source_id=$3 FOR UPDATE", [owner, this.environment, input.grantReference])).rows[0];
      if (!lot) fail('source_not_found', 'The original administrator grant is unavailable');
      const prior = await this.action(client, owner, 'revoke', input.reference);
      if (prior) {
        if (prior.lot_id !== lot.id || creditInteger(prior.amount) !== input.amount || prior.actor_id !== input.actor) fail('adjustment_conflict', 'Revocation reference conflicts with its original source');
        return { changed: false, lotId: lot.id, balance: (await this.summary(owner, client)).credits };
      }
      if (lot.status !== 'active' || creditInteger(lot.available) < input.amount) fail('source_insufficient', 'The original grant has insufficient unreserved Credits');
      const after = creditInteger(lot.available) - input.amount;
      await client.query('UPDATE credit_lots SET available=$2 WHERE id=$1', [lot.id, after]);
      await this.ledger(client, owner, lot.id, -input.amount, after, 'revoke', input.reference, input.actor);
      await this.recordAction(client, owner, 'revoke', input, lot.id);
      return { changed: true, lotId: lot.id, balance: (await this.summary(owner, client)).credits };
    });
  }
  async previewRevoke(owner: string, input: AdminRevoke) {
    audit(input.reference, input.actor); creditInteger(input.amount, true);
    await this.requireUnified(this.pool, owner);
    const lot = (await this.pool.query<Lot>("SELECT * FROM credit_lots WHERE owner_id=$1 AND environment=$2 AND kind='admin' AND source_id=$3", [owner, this.environment, input.grantReference])).rows[0];
    if (!lot) fail('source_not_found', 'The original administrator grant is unavailable');
    const prior = await this.action(this.pool, owner, 'revoke', input.reference);
    if (prior && (prior.lot_id !== lot.id || creditInteger(prior.amount) !== input.amount || prior.actor_id !== input.actor)) fail('adjustment_conflict', 'Revocation reference conflicts with its original source');
    if (!prior && (lot.status !== 'active' || creditInteger(lot.available) < input.amount)) fail('source_insufficient', 'The original grant has insufficient unreserved Credits');
    return { lotId: lot.id, available: creditInteger(lot.available), balance: (await this.summary(owner)).credits, alreadyApplied: Boolean(prior) };
  }
  async reserve(client: Client, input: { ownerId: string; jobId: string; amount: number; walletEpoch: number }): Promise<Status> {
    const amount = creditInteger(input.amount, true);
    await this.lockOwner(client, input.ownerId);
    const existing = await this.reservation(client, input.jobId, input.ownerId);
    if (existing) {
      if (creditInteger(existing.amount) !== amount || creditInteger(existing.wallet_epoch) !== input.walletEpoch) fail('idempotency_conflict', 'Task belongs to another reservation');
      await this.allocations(client, input.jobId, input.ownerId, existing);
      return existing.status;
    }
    await this.requireUnified(client, input.ownerId, input.walletEpoch);
    const lots = (await client.query<Lot>(`SELECT * FROM credit_lots WHERE owner_id=$1 AND environment=$2 AND status='active' AND available>0
      ORDER BY CASE kind WHEN 'reward' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,created_at,id FOR UPDATE`, [input.ownerId, this.environment])).rows;
    let remaining = amount;
    const parts: { lot: Lot; amount: number }[] = [];
    for (const lot of lots) { const part = Math.min(remaining, creditInteger(lot.available)); parts.push({ lot, amount: part }); remaining -= part; if (!remaining) break; }
    if (remaining) fail('insufficient_balance', 'Not enough Credits', 402);
    await client.query("INSERT INTO credit_reservations(job_id,owner_id,environment,amount,wallet_epoch,status) VALUES($1,$2,$3,$4,$5,'reserved')", [input.jobId, input.ownerId, this.environment, amount, input.walletEpoch]);
    for (const part of parts) {
      const after = creditInteger(part.lot.available) - part.amount;
      await client.query('UPDATE credit_lots SET available=$2 WHERE id=$1', [part.lot.id, after]);
      await client.query('INSERT INTO credit_allocations(job_id,lot_id,amount) VALUES($1,$2,$3)', [input.jobId, part.lot.id, part.amount]);
      await this.ledger(client, input.ownerId, part.lot.id, -part.amount, after, 'reserve', input.jobId);
    }
    return 'reserved';
  }
  async settle(client: Client, job: string, owner: string): Promise<Status> {
    await this.lockOwner(client, owner);
    const state = await this.reservation(client, job, owner);
    if (!state) fail('admission_missing', 'The original Credits reservation is missing');
    const allocations = await this.allocations(client, job, owner, state);
    if (state.status !== 'reserved') return state.status;
    for (const lot of allocations) await this.ledger(client, owner, lot.id, 0, creditInteger(lot.available), 'settle', job);
    await client.query("UPDATE credit_reservations SET status='settled' WHERE job_id=$1", [job]);
    return 'settled';
  }
  async refund(client: Client, job: string, owner: string): Promise<void> {
    await this.lockOwner(client, owner);
    const state = await this.reservation(client, job, owner);
    if (!state) fail('admission_missing', 'The original Credits reservation is missing');
    if (state.status !== 'reserved') return;
    for (const lot of await this.allocations(client, job, owner, state)) {
      const amount = creditInteger(lot.amount, true); const active = lot.status === 'active';
      const after = creditInteger(lot.available) + (active ? amount : 0); creditInteger(after);
      if (active) await client.query('UPDATE credit_lots SET available=$2 WHERE id=$1', [lot.id, after]);
      await this.ledger(client, owner, lot.id, active ? amount : 0, after, active ? 'refund' : 'refund_frozen', job);
    }
    await client.query("UPDATE credit_reservations SET status='refunded' WHERE job_id=$1", [job]);
  }
  async purchase(client: Client, order: { id: string; user_id: string; environment: CreditEnvironment; credits: number }): Promise<boolean> {
    await this.lockOwner(client, order.user_id);
    if (order.environment !== this.environment) fail('source_environment', 'Purchase environment differs from wallet');
    if ((await this.state(client, order.user_id)).phase !== 'unified') return false;
    await this.addLot(client, order.user_id, { kind: 'purchase', sourceId: order.id, originType: 'payment_order', originId: order.id, amount: order.credits, reason: 'purchase', reference: order.id });
    return true;
  }
  async freezePurchase(client: Client, owner: string, orderId: string): Promise<{ found: boolean; used: boolean }> {
    await this.lockOwner(client, owner);
    const lot = (await client.query<Lot>("SELECT * FROM credit_lots WHERE owner_id=$1 AND environment=$2 AND kind='purchase' AND source_id=$3 FOR UPDATE", [owner, this.environment, orderId])).rows[0];
    if (!lot) return { found: false, used: false };
    const used = (await client.query<{ used: boolean }>(`SELECT EXISTS(SELECT 1 FROM credit_allocations a JOIN credit_reservations r ON r.job_id=a.job_id
      WHERE a.lot_id=$1 AND r.status IN ('reserved','settled')) AS used`, [lot.id])).rows[0].used;
    const amount = creditInteger(lot.available);
    if (lot.status === 'active') {
      await client.query("UPDATE credit_lots SET available=0,status='frozen' WHERE id=$1", [lot.id]);
      if (amount) await this.ledger(client, owner, lot.id, -amount, 0, 'adjustment', orderId);
    }
    return { found: true, used };
  }
  private today() { return this.now().toISOString().slice(0, 10); }
  private async reservation(client: Client, job: string, owner: string) {
    const result = await client.query<Reservation>('SELECT * FROM credit_reservations WHERE job_id=$1 FOR UPDATE', [job]);
    const row = result.rows[0];
    if (row && (row.owner_id !== owner || row.environment !== this.environment)) fail('reservation_owner', 'Task reservation is outside this account');
    return row;
  }
  private async allocations(client: Client, job: string, owner: string, reservation: Reservation): Promise<Allocation[]> {
    const rows = (await client.query<Allocation>(`SELECT l.*,a.amount FROM credit_allocations a JOIN credit_lots l ON l.id=a.lot_id
      WHERE a.job_id=$1 ORDER BY l.id FOR UPDATE OF l`, [job])).rows;
    let sum = 0;
    for (const row of rows) {
      if (row.owner_id !== owner || row.environment !== this.environment) fail('allocation_invalid', 'Task allocation is outside this account');
      sum += creditInteger(row.amount, true); creditInteger(sum);
    }
    if (!rows.length || sum !== creditInteger(reservation.amount)) fail('allocation_invalid', 'Task allocation differs from the original reservation');
    return rows;
  }
  private async ledger(client: Client, owner: string, lot: string, delta: number, after: number, reason: string, reference: string, actor?: string) {
    await client.query(`INSERT INTO credit_ledger(owner_id,environment,lot_id,delta,balance_after,reason,reference_id,actor_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [owner, this.environment, lot, delta, after, reason, reference, actor ?? null]);
  }
  private async action(client: Client, owner: string, action: string, reference: string) {
    return (await client.query<{ lot_id: string; amount: string; actor_id: string }>('SELECT * FROM credit_actions WHERE owner_id=$1 AND environment=$2 AND action=$3 AND reference_id=$4', [owner, this.environment, action, reference])).rows[0];
  }
  private async recordAction(client: Client, owner: string, action: string, input: AdminGrant, lot: string) {
    await client.query('INSERT INTO credit_actions(owner_id,environment,action,reference_id,lot_id,amount,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)', [owner, this.environment, action, input.reference, lot, input.amount, input.actor]);
  }
}
