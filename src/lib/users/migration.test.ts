import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(new URL('../../../db/migrations/002_google_user_profiles.sql', import.meta.url), 'utf8');

describe('Google user profiles migration', () => {
  it('stores standard identity claims while excluding OAuth credentials', () => {
    expect(migration).toContain('google_subject TEXT PRIMARY KEY');
    expect(migration).toContain('email TEXT NOT NULL');
    expect(migration).toContain('email_verified BOOLEAN NOT NULL');
    expect(migration).toContain('given_name TEXT');
    expect(migration).toContain('family_name TEXT');
    expect(migration).toContain('picture_url TEXT');
    expect(migration).toContain('locale TEXT');
    expect(migration).toContain('hosted_domain TEXT');
    expect(migration).not.toMatch(/access_token|refresh_token|id_token/i);
  });
});
