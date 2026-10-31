import type { PoolClient } from 'pg';

export type ImageCreditOperation = 'watermark-removal' | 'background-removal' | 'object-removal';
export type ImageCreditCosts = Partial<Record<ImageCreditOperation, number>>;
export interface ImageCreditReservationInput {
  jobId: string;
  ownerId: string;
  environment: 'sandbox' | 'live';
  /** Optional only for the pre-upgrade one-credit contract; new quotes pass it. */
  amount?: number;
}
interface Reservation {
  user_id: string;
  status: 'reserved' | 'consumed' | 'refunded';
  source: 'free' | 'paid';
  lot_id: string | null;
  environment: 'sandbox' | 'live' | null;
  lot_user_id: string | null;
  amount: string | number;
}
interface Allocation {
  lot_id: string;
  amount: string | number;
  available: number;
  status: string;
  user_id: string;
  environment: 'sandbox' | 'live';
}
type QueryClient = Pick<PoolClient, 'query'>;

export async function getPurchasedImageBalance(client: QueryClient, ownerId: string, environment: 'sandbox' | 'live'): Promise<number> {
  const result = await client.query<{ balance: string | number }>(`
    SELECT COALESCE(SUM(l.available),0)::bigint AS balance
    FROM paid_credit_lots l JOIN payment_orders o ON o.id=l.order_id
    WHERE l.user_id=$1 AND l.status='active' AND o.environment=$2
  `, [ownerId, environment]);
  const balance = Number(result.rows[0].balance);
  if (!Number.isSafeInteger(balance) || balance < 0) throw new Error('Invalid purchased image balance');
  return balance;
}

// Call only inside the caller's financial transaction, after it initializes the
// existing free-use account. The shared lock order is owner, reservation, lot.
// The new processing pipeline may hold its processing-account lock before this
// owner lock. These helpers never acquire a processing-account or order lock.
async function lockOwner(client: PoolClient, input: ImageCreditReservationInput) {
  if (!input.jobId || !input.ownerId || !['sandbox', 'live'].includes(input.environment)) throw new Error('Invalid image credit reservation');
  const owner = await client.query('SELECT user_id FROM user_benefits WHERE user_id=$1 FOR UPDATE', [input.ownerId]);
  if (!owner.rows[0]) throw new Error('Image credit account is unavailable');
}
async function reservation(client: PoolClient, input: ImageCreditReservationInput) {
  const result = await client.query<Reservation>(`
    SELECT r.user_id,r.status,r.source,r.lot_id,r.amount,o.environment,l.user_id AS lot_user_id
    FROM job_credit_reservations r
    LEFT JOIN paid_credit_lots l ON l.id=r.lot_id
    LEFT JOIN payment_orders o ON o.id=l.order_id
    WHERE r.job_id=$1 FOR UPDATE OF r
  `, [input.jobId]);
  const state = result.rows[0];
  if (state && (state.user_id !== input.ownerId || state.source !== 'paid' || state.lot_user_id !== input.ownerId || state.environment !== input.environment)) throw new Error('Invalid image credit reservation');
  return state;
}

async function allocations(client: PoolClient, input: ImageCreditReservationInput, state: Reservation, lock = false): Promise<Allocation[]> {
  const result = await client.query<Allocation>(`
    SELECT a.lot_id,a.amount,l.available,l.status,l.user_id,o.environment
    FROM paid_credit_allocations a JOIN paid_credit_lots l ON l.id=a.lot_id
    JOIN payment_orders o ON o.id=l.order_id
    WHERE a.job_id=$1 ORDER BY l.created_at,l.id ${lock ? 'FOR UPDATE OF l' : ''}
  `, [input.jobId]);
  let rows = result.rows;
  // Compatibility with old one-credit reservations before allocation backfill.
  if (rows.length === 0 && Number(state.amount) === 1 && state.lot_id) {
    const legacy = await client.query<Allocation>(`
      SELECT l.id AS lot_id,1::int AS amount,l.available,l.status,l.user_id,o.environment
      FROM paid_credit_lots l JOIN payment_orders o ON o.id=l.order_id
      WHERE l.id=$1 ${lock ? 'FOR UPDATE OF l' : ''}
    `, [state.lot_id]);
    rows = legacy.rows;
  }
  const amount = Number(state.amount);
  let total = 0;
  for (const allocation of rows) {
    const part = Number(allocation.amount);
    if (!Number.isSafeInteger(part) || part < 1 || allocation.user_id !== input.ownerId || allocation.environment !== input.environment) throw new Error('Invalid image credit allocation');
    total += part;
  }
  if (!Number.isSafeInteger(amount) || amount < 1 || !Number.isSafeInteger(total) || total !== amount || !rows.some((row) => row.lot_id === state.lot_id)) throw new Error('Invalid image credit allocation');
  return rows;
}

export async function reservePurchasedImageCredit(client: PoolClient, input: ImageCreditReservationInput): Promise<boolean> {
  const amount = input.amount ?? 1;
  if (!Number.isSafeInteger(amount) || amount < 1) throw new Error('Invalid image credit amount');
  await lockOwner(client, input);
  const existing = await reservation(client, input);
  if (existing) {
    if (existing.status === 'refunded') throw new Error('Invalid image credit reservation');
    await allocations(client, input, existing);
    return true;
  }
  const result = await client.query<{ id: string; available: number }>(`
    SELECT l.id,l.available FROM paid_credit_lots l JOIN payment_orders o ON o.id=l.order_id
    WHERE l.user_id=$1 AND l.status='active' AND l.available>0 AND o.environment=$2
    ORDER BY l.created_at,l.id FOR UPDATE OF l
  `, [input.ownerId, input.environment]);
  let remaining = amount;
  const parts: { id: string; amount: number; available: number }[] = [];
  for (const lot of result.rows) {
    const part = Math.min(lot.available, remaining);
    parts.push({ id: lot.id, amount: part, available: lot.available });
    remaining -= part;
    if (remaining === 0) break;
  }
  // A shortfall returns without any partial debit or reservation/ledger write.
  if (remaining > 0) return false;
  await client.query("INSERT INTO job_credit_reservations(job_id,user_id,status,source,lot_id,amount) VALUES ($1,$2,'reserved','paid',$3,$4)", [input.jobId, input.ownerId, parts[0].id, amount]);
  for (const part of parts) {
    await client.query('UPDATE paid_credit_lots SET available=available-$2 WHERE id=$1', [part.id, part.amount]);
    await client.query('INSERT INTO paid_credit_allocations(job_id,lot_id,amount) VALUES ($1,$2,$3)', [input.jobId, part.id, part.amount]);
    await client.query("INSERT INTO paid_credit_ledger(user_id,lot_id,delta,balance_after,reason,reference_id) VALUES ($1,$2,$3,$4,'job_reserve',$5)", [input.ownerId, part.id, -part.amount, part.available - part.amount, input.jobId]);
  }
  return true;
}

export async function consumePurchasedImageCredit(client: PoolClient, input: ImageCreditReservationInput): Promise<void> {
  await lockOwner(client, input);
  const state = await reservation(client, input);
  if (!state || state.status === 'refunded') throw new Error('Invalid image credit reservation');
  await allocations(client, input, state);
  if (state.status === 'consumed') return;
  await client.query("UPDATE job_credit_reservations SET status='consumed',updated_at=NOW() WHERE job_id=$1", [input.jobId]);
  await client.query('UPDATE user_benefits SET last_active_at=NOW(),last_processed_at=NOW() WHERE user_id=$1', [input.ownerId]);
}

export async function refundPurchasedImageCredit(client: PoolClient, input: ImageCreditReservationInput): Promise<void> {
  await lockOwner(client, input);
  const state = await reservation(client, input);
  if (!state) throw new Error('Invalid image credit reservation');
  if (state.status !== 'reserved') return;
  const original = await allocations(client, input, state, true);
  for (const lot of original) {
    const active = lot.status === 'active';
    const amount = Number(lot.amount);
    if (active) await client.query('UPDATE paid_credit_lots SET available=available+$2 WHERE id=$1', [lot.lot_id, amount]);
    await client.query('INSERT INTO paid_credit_ledger(user_id,lot_id,delta,balance_after,reason,reference_id) VALUES ($1,$2,$3,$4,$5,$6)', [input.ownerId, lot.lot_id, active ? amount : 0, active ? lot.available + amount : lot.available, active ? 'job_refund' : 'job_refund_frozen', input.jobId]);
  }
  await client.query("UPDATE job_credit_reservations SET status='refunded',updated_at=NOW() WHERE job_id=$1", [input.jobId]);
}
