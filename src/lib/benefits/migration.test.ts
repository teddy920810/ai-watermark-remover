import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(new URL('../../../db/migrations/001_user_benefits.sql', import.meta.url), 'utf8');

describe('user benefits migration', () => {
  it('enforces the free-use cap and idempotent daily and job records', () => {
    expect(migration).toContain('balance BETWEEN 0 AND 3');
    expect(migration).toContain('PRIMARY KEY (user_id, checkin_date)');
    expect(migration).toContain('job_credit_reservations');
    expect(migration).toContain("status IN ('reserved', 'consumed', 'refunded')");
    expect(migration).toContain('benefit_ledger');
  });
});
