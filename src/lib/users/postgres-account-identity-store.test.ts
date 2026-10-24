import { readFileSync } from 'node:fs';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { PostgresAccountIdentityStore } from './postgres-account-identity-store';

function fixture(options: { profileCount?: number; bound?: { owner_id: string; verified_email: string; google_subject?: string }; legacyOwner?: string; rawOwner?: boolean; legacySessionOwner?: boolean } = {}) {
  let binding = options.bound;
  const query = vi.fn(async (raw: string, values: unknown[] = []) => {
    const sql = raw.replace(/\s+/g, ' ').trim();
    if (sql.includes('FROM google_user_profiles') && sql.startsWith('SELECT google_subject')) return { rows: Array.from({ length: options.profileCount ?? 1 }, (_, n) => ({ google_subject: `subject-${n + 1}` })) };
    if (sql.includes('FROM user_benefit_identities')) return { rows: options.legacyOwner ? [{ user_id: options.legacyOwner }] : [] };
    if (sql.startsWith('SELECT') && sql.includes('FROM google_account_owners')) {
      if (sql.includes('JOIN google_user_profiles')) return { rows: options.legacySessionOwner && binding ? [binding] : [] };
      if (sql.includes('WHERE owner_id')) return { rows: options.rawOwner && binding ? [binding] : [] };
      return { rows: binding ? [binding] : [] };
    }
    if (sql.startsWith('INSERT INTO google_account_owners')) { binding = { google_subject: String(values[0]), owner_id: String(values[1]), verified_email: String(values[2]) }; return { rows: [] }; }
    return { rows: [] };
  });
  const client = { query, release: vi.fn() }; const pool = { query, connect: vi.fn(async () => client) } as unknown as Pool;
  return { store: new PostgresAccountIdentityStore(pool, () => 'new-stable-owner'), query, pool };
}

describe('Postgres canonical Google account identities', () => {
  it('keeps an existing subject bound to the same owner and never moves financial or R2 data', async () => {
    const f = fixture({ bound: { google_subject: 'subject-1', owner_id: 'legacy-owner', verified_email: 'person@gmail.com' }, legacyOwner: 'legacy-owner' });
    expect(await f.store.resolveGoogleUser({ email: 'Person@gmail.com', emailVerified: true })).toBe('legacy-owner');
    const sql = f.query.mock.calls.map(([text]) => text); expect(sql[0]).toBe('BEGIN'); expect(sql.at(-1)).toBe('COMMIT'); expect(sql.some((s) => s.includes('pg_advisory_xact_lock'))).toBe(true);
    expect(sql.join('\n')).not.toMatch(/UPDATE user_benefits|processing_accounts|benefit_ledger|processing_admissions/i);
  });
  it('creates a stable owner only for a new verified subject without a legacy email account', async () => {
    const f = fixture(); expect(await f.store.resolveGoogleUser({ email: 'new@gmail.com', emailVerified: true })).toBe('new-stable-owner');
    expect(await f.store.resolveGoogleUser({ email: 'new@gmail.com', emailVerified: true })).toBe('new-stable-owner');
  });
  it('refuses unverified/ambiguous profiles and a subject trying to claim another legacy email owner', async () => {
    const unverified = fixture(); await expect(unverified.store.resolveGoogleUser({ email: 'person@gmail.com', emailVerified: false })).rejects.toMatchObject({ code: 'identity_unverified' }); expect(unverified.pool.connect).not.toHaveBeenCalled();
    for (const f of [fixture({ profileCount: 2 }), fixture({ legacyOwner: 'unmigrated-owner' }), fixture({ bound: { owner_id: 'owner-a', verified_email: 'person@gmail.com' }, legacyOwner: 'owner-b' })]) await expect(f.store.resolveGoogleUser({ email: 'person@gmail.com', emailVerified: true })).rejects.toMatchObject({ code: 'identity_conflict' });
  });
  it('uses the canonical subject-bound ID directly, including after a verified email change', async () => {
    const f = fixture({ bound: { owner_id: 'stable-owner', verified_email: 'new@workspace.test' }, rawOwner: true });
    expect(await f.store.resolveAuthenticatedUser({ id: 'stable-owner', email: 'old@workspace.test', emailVerified: true })).toEqual({ id: 'stable-owner', email: 'new@workspace.test' });
  });
  it('recovers an old signed verified Gmail session only through the migrated unique Google binding', async () => {
    const f = fixture({ bound: { owner_id: 'legacy-owner', verified_email: 'person@gmail.com' }, legacySessionOwner: true });
    expect(await f.store.resolveAuthenticatedUser({ id: 'new-random-id', email: 'Person@gmail.com', emailVerified: true })).toEqual({ id: 'legacy-owner', email: 'person@gmail.com' });
    expect(f.query.mock.calls.every(([text]) => text.trimStart().startsWith('SELECT'))).toBe(true);
    await expect(f.store.resolveAuthenticatedUser({ id: 'random', email: 'person@third-party.test', emailVerified: true })).rejects.toMatchObject({ code: 'identity_reauthentication_required' });
    await expect(fixture().store.resolveAuthenticatedUser({ id: 'random', email: 'person@gmail.com', emailVerified: true })).rejects.toMatchObject({ code: 'identity_reauthentication_required' });
  });
  it('backfills only uniquely verified historical subject mappings without updating existing account ownership', () => {
    const sql = readFileSync(new URL('../../../db/migrations/007_google_account_owners.sql', import.meta.url), 'utf8');
    expect(sql).toContain('google_subject TEXT PRIMARY KEY'); expect(sql).toContain('owner_id TEXT NOT NULL UNIQUE'); expect(sql).toContain('email_verified = TRUE'); expect(sql).toContain('profile_count = 1');
    expect(sql).not.toMatch(/UPDATE user_benefit_identities|UPDATE processing_|DELETE FROM|UPDATE user_benefits/i);
  });
});
