import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { AccountIdentityError } from './account-identity';
import type { AccountIdentityStore, AuthenticatedAccountUser, CanonicalAccountIdentity } from './account-identity';

interface Binding { google_subject: string; owner_id: string; verified_email: string }
function verifiedEmail(user: Pick<AuthenticatedAccountUser, 'email' | 'emailVerified'>): string {
  if (user.emailVerified !== true || typeof user.email !== 'string' || user.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)) throw new AccountIdentityError('identity_unverified');
  return user.email.trim().toLowerCase();
}
const canonical = (binding: Binding): CanonicalAccountIdentity => ({ id: binding.owner_id, email: binding.verified_email });

export class PostgresAccountIdentityStore implements AccountIdentityStore {
  constructor(private readonly pool: Pool, private readonly id: () => string = randomUUID) {}

  async resolveGoogleUser(user: Pick<AuthenticatedAccountUser, 'email' | 'emailVerified'>): Promise<string> {
    const email = verifiedEmail(user);
    return this.transaction(async (client) => {
      // Authentication is low-volume; a short registry lock also serializes
      // first logins for different subjects competing for one legacy email.
      await client.query('SELECT pg_advisory_xact_lock($1)', [820261024]);
      const profiles = await client.query<{ google_subject: string }>('SELECT google_subject FROM google_user_profiles WHERE LOWER(email) = LOWER($1) AND email_verified = TRUE', [email]);
      if (profiles.rows.length !== 1) throw new AccountIdentityError('identity_conflict');
      const subject = profiles.rows[0].google_subject;
      const bound = await client.query<Binding>('SELECT google_subject, owner_id, verified_email FROM google_account_owners WHERE google_subject = $1 FOR UPDATE', [subject]);
      const legacy = await client.query<{ user_id: string }>('SELECT user_id FROM user_benefit_identities WHERE LOWER(email) = LOWER($1)', [email]);
      if (legacy.rows.length > 1 || legacy.rows[0] && legacy.rows[0].user_id !== bound.rows[0]?.owner_id) throw new AccountIdentityError('identity_conflict');
      // An unbound existing legacy account is never claimed merely by email.
      // Its subject association must be explicitly established by migration.
      const owner = bound.rows[0]?.owner_id ?? this.id();
      await client.query('INSERT INTO google_account_owners (google_subject, owner_id, verified_email) VALUES ($1,$2,$3) ON CONFLICT (google_subject) DO UPDATE SET verified_email = EXCLUDED.verified_email, updated_at = NOW()', [subject, owner, email]);
      return owner;
    });
  }

  async resolveAuthenticatedUser(user: AuthenticatedAccountUser): Promise<CanonicalAccountIdentity> {
    const email = verifiedEmail(user);
    const direct = await this.pool.query<Binding>('SELECT google_subject, owner_id, verified_email FROM google_account_owners WHERE owner_id = $1', [user.id]);
    if (direct.rows.length === 1) return canonical(direct.rows[0]);
    // Existing stateless cookies have no Google subject. Compatibility is
    // deliberately limited to Google's authoritative Gmail namespace and an
    // already-migrated unique provider binding. No client ID/email is rebound.
    // https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
    if (!email.endsWith('@gmail.com')) throw new AccountIdentityError('identity_reauthentication_required');
    const migrated = await this.pool.query<Binding>(`
      SELECT owners.google_subject, owners.owner_id, owners.verified_email
      FROM google_account_owners owners
      JOIN google_user_profiles profile ON profile.google_subject = owners.google_subject
      JOIN user_benefit_identities identity ON identity.user_id = owners.owner_id
      WHERE LOWER(owners.verified_email) = LOWER($1) AND LOWER(profile.email) = LOWER($1)
        AND LOWER(identity.email) = LOWER($1) AND profile.email_verified = TRUE
        AND (SELECT COUNT(*) FROM google_user_profiles p WHERE LOWER(p.email) = LOWER($1) AND p.email_verified = TRUE) = 1
    `, [email]);
    if (migrated.rows.length !== 1) throw new AccountIdentityError('identity_reauthentication_required');
    return canonical(migrated.rows[0]);
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); if ((error as { code?: string }).code === '23505') throw new AccountIdentityError('identity_conflict'); throw error; }
    finally { client.release(); }
  }
}
