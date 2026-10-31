import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { PostgresBenefitStore } from './postgres-benefit-store';

interface FakeState {
  balance: number;
  checkedInToday?: boolean;
  activeReservations?: number;
  insertedUser?: boolean;
  email?: string;
  paidBalance?: number;
  reservation?: { user_id: string; status: string };
}

function createPool(state: FakeState) {
  let exists = !state.insertedUser;
  const query = vi.fn(async (source: string, values?: unknown[]) => {
    const sql = source.replace(/\s+/g, ' ').trim();
    if (sql.includes('SUM(l.available)')) return { rows: [{ balance: state.paidBalance ?? 0 }] };
    if (sql.startsWith('INSERT INTO user_benefits')) {
      const inserted = !exists;
      exists = true;
      return { rows: inserted ? [{ balance: 1 }] : [] };
    }
    if (sql.startsWith('INSERT INTO user_benefit_identities')) {
      state.email = String(values?.[1]);
      return { rows: [] };
    }
    if (sql.startsWith('SELECT balance::int AS balance FROM user_benefits')) {
      return { rows: [{ balance: state.balance }] };
    }
    if (sql.startsWith('SELECT EXISTS (')) {
      return { rows: [{ checked_in_today: state.checkedInToday ?? false, active_reservations: state.activeReservations ?? 0 }] };
    }
    if (sql.startsWith('SELECT user_id, status FROM job_credit_reservations')) {
      return { rows: state.reservation ? [state.reservation] : [] };
    }
    if (sql.startsWith('UPDATE user_benefits') && sql.includes('balance = balance +')) {
      state.balance += 1;
      return { rows: [{ balance: state.balance }] };
    }
    if (sql.startsWith('UPDATE user_benefits') && sql.includes('balance = balance - 1')) {
      state.balance -= 1;
      return { rows: [{ balance: state.balance }] };
    }
    if (sql.includes('checked_in_today')) {
      return { rows: exists ? [{ balance: state.balance, checked_in_today: state.checkedInToday ?? false, active_reservations: 0, identity_email: state.email ?? null }] : [] };
    }
    return { rows: [] };
  });
  const release = vi.fn();
  return {
    pool: { query, connect: vi.fn().mockResolvedValue({ query, release }) } as unknown as Pool,
    query,
    release,
  };
}

describe('PostgresBenefitStore', () => {
  it('adds purchased image uses to a read-only existing-account summary without changing free entitlement', async () => {
    const state = { balance: 2, email: 'person@example.com', paidBalance: 5 };
    const fake = createPool(state);
    expect(await new PostgresBenefitStore(fake.pool, true, 'live').getSummary('user-1', 'person@example.com')).toMatchObject({
      balance: 2, paidBalance: 5,
    });
    expect(await new PostgresBenefitStore(fake.pool, true, 'live').getSummary('user-1', 'person@example.com')).not.toHaveProperty('totalBalance');
    expect(fake.pool.connect).not.toHaveBeenCalled();
    expect(fake.query.mock.calls.every(([sql]) => sql.trim().startsWith('SELECT'))).toBe(true);
  });

  it('reads an existing account and matching normalized email without a transaction or activity writes', async () => {
    const state = { balance: 2, email: 'person@example.com' };
    const fake = createPool(state); const store = new PostgresBenefitStore(fake.pool);
    expect(await store.getSummary('user-1', ' Person@Example.com ')).toMatchObject({ balance: 2 });
    state.balance = 0;
    expect(await store.getSummary('user-1', 'person@example.com')).toMatchObject({ balance: 0 });
    expect(fake.pool.connect).not.toHaveBeenCalled();
    expect(fake.query.mock.calls).toHaveLength(2);
    expect(fake.query.mock.calls.every(([sql, values]) => sql.trim().startsWith('SELECT') && values?.[0] === 'user-1')).toBe(true);
  });

  it('reads an existing account without an email without starting a transaction', async () => {
    const fake = createPool({ balance: 0 });
    expect(await new PostgresBenefitStore(fake.pool).getSummary('user-1')).toMatchObject({ balance: 0 });
    expect(fake.pool.connect).not.toHaveBeenCalled();
    expect(fake.query).toHaveBeenCalledOnce();
  });

  it('initializes a missing account once, then reads its live balance without issuing another reward', async () => {
    const fake = createPool({ balance: 1, insertedUser: true }); const store = new PostgresBenefitStore(fake.pool);
    expect(await store.getSummary('user-1', 'Person@Example.com')).toMatchObject({ balance: 1 });
    expect(await store.getSummary('user-1', 'person@example.com')).toMatchObject({ balance: 1 });
    expect(fake.query.mock.calls.filter(([sql]) => sql.includes("'first_use'"))).toHaveLength(1);
    expect(fake.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO user_benefit_identities'))).toHaveLength(1);
    expect(fake.pool.connect).toHaveBeenCalledOnce();
  });

  it('synchronizes a changed email once without changing or granting the existing balance', async () => {
    const state = { balance: 0, email: 'old@example.com' }; const fake = createPool(state); const store = new PostgresBenefitStore(fake.pool);
    expect(await store.getSummary('user-1', ' New@Example.com ')).toMatchObject({ balance: 0 });
    expect(await store.getSummary('user-1', 'new@example.com')).toMatchObject({ balance: 0 });
    expect(state.email).toBe('new@example.com');
    expect(fake.pool.connect).toHaveBeenCalledOnce();
    expect(fake.query.mock.calls.some(([sql]) => sql.includes("'first_use'"))).toBe(false);
  });

  it('returns an already reserved free use even when the available balance has reached the reward cap', async () => {
    const state = { balance: 3, reservation: { user_id: 'user-1', status: 'reserved' } };
    const fake = createPool(state);
    await new PostgresBenefitStore(fake.pool).refund('job-1', 'user-1');
    expect(state.balance).toBe(4);
    expect(fake.query).toHaveBeenLastCalledWith('COMMIT');
    expect(fake.query.mock.calls.some(([sql]) => sql.includes("'job_refund'"))).toBe(true);
  });

  it('initializes a user with one free use and records first-use activity', async () => {
    const fake = createPool({ balance: 1, insertedUser: true });
    const summary = await new PostgresBenefitStore(fake.pool).getSummary('user-1');
    expect(summary).toEqual({ balance: 1, cap: 3, dailyReward: 1, checkedInToday: false });
    expect(fake.query.mock.calls.some(([sql]) => sql.includes("'first_use'"))).toBe(true);
    expect(fake.query).toHaveBeenLastCalledWith('COMMIT');
    expect(fake.release).toHaveBeenCalled();
  });

  it('links the authenticated email to the benefit account without changing the balance', async () => {
    const fake = createPool({ balance: 2 });
    const summary = await new PostgresBenefitStore(fake.pool).getSummary('user-1', 'Person@Example.com');
    expect(summary.balance).toBe(2);
    expect(fake.query.mock.calls).toContainEqual([
      expect.stringContaining('INSERT INTO user_benefit_identities'),
      ['user-1', 'person@example.com'],
    ]);
  });

  it('grants one daily use and marks the day checked in', async () => {
    const fake = createPool({ balance: 1 });
    const result = await new PostgresBenefitStore(fake.pool).checkIn('user-1');
    expect(result).toEqual({ balance: 2, cap: 3, dailyReward: 1, checkedInToday: true, granted: true, balanceFull: false });
    expect(fake.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO daily_checkins'))).toBe(true);
  });

  it('does not consume the daily check-in opportunity while total entitlement is at the cap', async () => {
    const fake = createPool({ balance: 2, activeReservations: 1 });
    const result = await new PostgresBenefitStore(fake.pool).checkIn('user-1');
    expect(result).toMatchObject({ balance: 2, checkedInToday: false, granted: false, balanceFull: true });
    expect(fake.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO daily_checkins'))).toBe(false);
  });

  it('rolls back without reserving a job when the balance is empty', async () => {
    const fake = createPool({ balance: 0 });
    await expect(new PostgresBenefitStore(fake.pool).reserve('job-1', 'user-1')).rejects.toThrow('No free uses remaining');
    expect(fake.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(fake.query.mock.calls.some(([sql]) => sql.includes("VALUES ($1, $2, 'reserved')"))).toBe(false);
    expect(fake.release).toHaveBeenCalled();
  });
});
