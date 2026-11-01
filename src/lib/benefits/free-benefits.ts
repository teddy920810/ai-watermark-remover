import type { PoolClient } from 'pg';

/** The caller owns the transaction and lock order; this primitive never connects or commits. */
export async function ensureFreeBenefitAccount(
  client: Pick<PoolClient, 'query'>,
  userId: string,
  options: { touchActivity?: boolean; email?: string } = {},
): Promise<void> {
  const inserted = await client.query(`
    INSERT INTO user_benefits (user_id, balance)
    VALUES ($1, 1)
    ON CONFLICT (user_id) DO NOTHING
    RETURNING user_id
  `, [userId]);
  if (inserted.rows[0]) await client.query(`
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
}
