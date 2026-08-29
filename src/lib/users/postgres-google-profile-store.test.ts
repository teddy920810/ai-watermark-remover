import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { PostgresGoogleProfileStore } from './postgres-google-profile-store';

describe('PostgresGoogleProfileStore', () => {
  it('upserts all identity fields by stable Google subject without storing tokens', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;
    const store = new PostgresGoogleProfileStore(pool);

    await store.save({
      googleSubject: 'google-user-123',
      email: 'person@example.com',
      emailVerified: true,
      name: 'Example Person',
      givenName: 'Example',
      familyName: 'Person',
      pictureUrl: 'https://lh3.googleusercontent.com/avatar',
      locale: 'zh-CN',
      hostedDomain: 'example.com',
    });

    const [sql, values] = query.mock.calls[0];
    expect(sql).toContain('INSERT INTO google_user_profiles');
    expect(sql).toContain('ON CONFLICT (google_subject) DO UPDATE');
    expect(sql).toContain('last_authorized_at = NOW()');
    expect(sql).not.toMatch(/access_token|refresh_token|id_token/i);
    expect(values).toEqual([
      'google-user-123',
      'person@example.com',
      true,
      'Example Person',
      'Example',
      'Person',
      'https://lh3.googleusercontent.com/avatar',
      'zh-CN',
      'example.com',
    ]);
  });
});
