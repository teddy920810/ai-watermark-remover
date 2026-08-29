import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(new URL('../../../db/migrations/001_user_benefits.sql', import.meta.url), 'utf8');
const testGrantMigration = readFileSync(new URL('../../../db/migrations/003_test_credit_grants.sql', import.meta.url), 'utf8');
const benefitIdentityMigration = readFileSync(new URL('../../../db/migrations/004_benefit_user_identities.sql', import.meta.url), 'utf8');

describe('user benefits migration', () => {
  it('enforces the free-use cap and idempotent daily and job records', () => {
    expect(migration).toContain('balance BETWEEN 0 AND 3');
    expect(migration).toContain('PRIMARY KEY (user_id, checkin_date)');
    expect(migration).toContain('job_credit_reservations');
    expect(migration).toContain("status IN ('reserved', 'consumed', 'refunded')");
    expect(migration).toContain('benefit_ledger');
  });
});

describe('test credit grant migration', () => {
  it('adds a dedicated auditable ledger reason without weakening the balance cap', () => {
    expect(testGrantMigration).toContain("'test_grant'");
    expect(testGrantMigration).toContain('balance_after BETWEEN 0 AND 3');
    expect(testGrantMigration).not.toContain('DROP TABLE');
  });
});

describe('benefit identity migration', () => {
  it('maps an authenticated email to exactly one benefit account', () => {
    expect(benefitIdentityMigration).toContain('CREATE TABLE IF NOT EXISTS user_benefit_identities');
    expect(benefitIdentityMigration).toContain('REFERENCES user_benefits(user_id)');
    expect(benefitIdentityMigration).toContain('UNIQUE INDEX');
    expect(benefitIdentityMigration).toContain('LOWER(email)');
  });
});
