import { describe, expect, it } from 'vitest';
import { grantTestCredits, planTestCreditGrant } from '../../../scripts/grant-test-credits.mjs';

describe('test credit grant planning', () => {
  it('fills only the available balance and creates stable audit references', () => {
    expect(planTestCreditGrant({ currentBalance: 1, requestedUses: 3, reference: 'qa-download' })).toEqual({
      appliedUses: 2,
      balanceAfter: 3,
      ledgerReferences: ['qa-download:1', 'qa-download:2'],
    });
  });

  it('does not grant beyond the account cap', () => {
    expect(planTestCreditGrant({ currentBalance: 3, requestedUses: 2, reference: 'qa-full' })).toEqual({
      appliedUses: 0,
      balanceAfter: 3,
      ledgerReferences: [],
    });
  });

  it('rejects unsafe requests before opening the database', () => {
    expect(() => planTestCreditGrant({ currentBalance: 0, requestedUses: 0, reference: 'qa' })).toThrow('between 1 and 3');
    expect(() => planTestCreditGrant({ currentBalance: 0, requestedUses: 1, reference: 'spaces are unsafe' })).toThrow('reference');
  });
});

describe('test credit grant database operation', () => {
  it('keeps dry runs read-only and returns the capped plan', async () => {
    const query = async (sql: string) => {
      if (sql.includes('SELECT u.id AS user_id')) return { rows: [{ user_id: 'user-1', balance: 2 }] };
      throw new Error(`Unexpected write: ${sql}`);
    };
    const client = { query, release: () => undefined };
    const pool = { connect: async () => client };

    await expect(grantTestCredits({
      pool,
      email: 'qa@example.com',
      requestedUses: 3,
      reference: 'qa-download',
      apply: false,
    })).resolves.toEqual({
      mode: 'dry-run',
      requestedUses: 3,
      appliedUses: 1,
      balanceBefore: 2,
      balanceAfter: 3,
    });
  });

  it('records one ledger row per applied use inside a transaction', async () => {
    const statements: string[] = [];
    const query = async (sql: string) => {
      statements.push(sql.replace(/\s+/g, ' ').trim());
      if (sql.includes('SELECT u.id AS user_id')) return { rows: [{ user_id: 'user-1', balance: 0 }] };
      if (sql.includes('INSERT INTO benefit_ledger')) return { rows: [{ id: statements.length }] };
      return { rows: [] };
    };
    const client = { query, release: () => undefined };
    const pool = { connect: async () => client };

    await expect(grantTestCredits({
      pool,
      email: 'qa@example.com',
      requestedUses: 2,
      reference: 'qa-download',
      apply: true,
    })).resolves.toMatchObject({ mode: 'applied', appliedUses: 2, balanceBefore: 0, balanceAfter: 2 });
    expect(statements[0]).toBe('BEGIN');
    expect(statements.at(-1)).toBe('COMMIT');
    expect(statements.filter((sql) => sql.includes("'test_grant'")).length).toBe(2);
  });
});
