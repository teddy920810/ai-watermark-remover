import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { PostgresBenefitStore } from './postgres-benefit-store';

interface FakeState {
  balance: number;
  checkedInToday?: boolean;
  activeReservations?: number;
  insertedUser?: boolean;
  reservation?: { user_id: string; status: string };
}

function createPool(state: FakeState) {
  const query = vi.fn(async (source: string) => {
    const sql = source.replace(/\s+/g, ' ').trim();
    if (sql.startsWith('INSERT INTO user_benefits')) {
      return { rows: state.insertedUser ? [{ balance: 1 }] : [] };
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
      return { rows: [{ balance: state.balance, checked_in_today: state.checkedInToday ?? false, active_reservations: 0 }] };
    }
    return { rows: [] };
  });
  const release = vi.fn();
  return {
    pool: { connect: vi.fn().mockResolvedValue({ query, release }) } as unknown as Pool,
    query,
    release,
  };
}

describe('PostgresBenefitStore', () => {
  it('initializes a user with one free use and records first-use activity', async () => {
    const fake = createPool({ balance: 1, insertedUser: true });
    const summary = await new PostgresBenefitStore(fake.pool).getSummary('user-1');
    expect(summary).toEqual({ balance: 1, cap: 3, dailyReward: 1, checkedInToday: false });
    expect(fake.query.mock.calls.some(([sql]) => sql.includes("'first_use'"))).toBe(true);
    expect(fake.query).toHaveBeenLastCalledWith('COMMIT');
    expect(fake.release).toHaveBeenCalled();
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
