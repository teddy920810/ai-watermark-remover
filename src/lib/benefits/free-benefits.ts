import type { PoolClient } from 'pg';

/** Transaction-scoped owner fence works before an account's first row exists. */
export async function lockFinancialOwner(client: Pick<PoolClient, 'query'>, owner: string): Promise<void> {
  if (!owner || owner.length > 512) throw new Error('A canonical account owner is required');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`credits-owner:${owner}`]);
}

/** The caller owns the transaction and lock order; this primitive never connects or commits. */
export async function ensureFreeBenefitAccount(
  client: Pick<PoolClient, 'query'>,
  userId: string,
  options: { touchActivity?: boolean; email?: string; initialFreeUses?: 0 | 1 } = {},
): Promise<boolean> {
  const initial = options.initialFreeUses ?? 1;
  await lockFinancialOwner(client, userId);
  const inserted = await client.query(`
    INSERT INTO user_benefits (user_id, balance)
    VALUES ($1, $2)
    ON CONFLICT (user_id) DO NOTHING
    RETURNING user_id
  `, [userId, initial]);
  if (inserted.rows[0] && initial > 0) await client.query(`
    INSERT INTO benefit_ledger (user_id, delta, balance_after, reason, reference_id)
    VALUES ($1, 1, 1, 'first_use', $1)
  `, [userId]);
  if (options.touchActivity) await client.query('UPDATE user_benefits SET last_active_at = NOW() WHERE user_id = $1', [userId]);
  if (options.email) await client.query(`
    INSERT INTO user_benefit_identities (user_id, email)
    VALUES ($1, $2)
    ON CONFLICT (user_id) DO UPDATE SET
      email = EXCLUDED.email,
      updated_at = NOW()
  `, [userId, options.email.trim().toLowerCase()]);
  return Boolean(inserted.rows[0]);
}
