import type { Pool, PoolClient } from 'pg';
import {
  DAILY_REWARD,
  FREE_USE_CAP,
  type BenefitStore,
  type BenefitSummary,
  type CheckInResult,
} from './benefit-store';

interface UserState {
  balance: number;
  checked_in_today: boolean;
  active_reservations: number;
}

export class PostgresBenefitStore implements BenefitStore {
  constructor(private readonly pool: Pool) {}

  async getSummary(userId: string): Promise<BenefitSummary> {
    return this.transaction(async (client) => {
      await this.ensureUser(client, userId);
      const result = await client.query<UserState>(`
        SELECT
          balance::int AS balance,
          EXISTS (
            SELECT 1 FROM daily_checkins
            WHERE user_id = $1 AND checkin_date = (NOW() AT TIME ZONE 'UTC')::date
          ) AS checked_in_today,
          0::int AS active_reservations
        FROM user_benefits
        WHERE user_id = $1
      `, [userId]);
      return this.summary(result.rows[0]);
    });
  }

  async checkIn(userId: string): Promise<CheckInResult> {
    return this.transaction(async (client) => {
      await this.ensureUser(client, userId);
      const user = await client.query<{ balance: number }>(`
        SELECT balance::int AS balance
        FROM user_benefits
        WHERE user_id = $1
        FOR UPDATE
      `, [userId]);
      const activity = await client.query<Pick<UserState, 'checked_in_today' | 'active_reservations'>>(`
        SELECT
          EXISTS (
            SELECT 1 FROM daily_checkins
            WHERE user_id = $1 AND checkin_date = (NOW() AT TIME ZONE 'UTC')::date
          ) AS checked_in_today,
          (
            SELECT COUNT(*)::int FROM job_credit_reservations
            WHERE user_id = $1 AND status = 'reserved'
          ) AS active_reservations
      `, [userId]);
      const state: UserState = { balance: user.rows[0].balance, ...activity.rows[0] };
      if (state.checked_in_today) {
        return { ...this.summary(state), granted: false, balanceFull: false };
      }
      if (state.balance + state.active_reservations >= FREE_USE_CAP) {
        return { ...this.summary(state), granted: false, balanceFull: true };
      }

      await client.query(`
        INSERT INTO daily_checkins (user_id, checkin_date, reward)
        VALUES ($1, (NOW() AT TIME ZONE 'UTC')::date, $2)
      `, [userId, DAILY_REWARD]);
      const updated = await client.query<{ balance: number }>(`
        UPDATE user_benefits
        SET balance = balance + $2, last_active_at = NOW()
        WHERE user_id = $1
        RETURNING balance::int AS balance
      `, [userId, DAILY_REWARD]);
      const balance = updated.rows[0].balance;
      await client.query(`
        INSERT INTO benefit_ledger (user_id, delta, balance_after, reason, reference_id)
        VALUES ($1, $2, $3, 'daily_checkin', (NOW() AT TIME ZONE 'UTC')::date::text)
      `, [userId, DAILY_REWARD, balance]);
      return { balance, cap: FREE_USE_CAP, dailyReward: DAILY_REWARD, checkedInToday: true, granted: true, balanceFull: false };
    });
  }

  async reserve(jobId: string, userId: string): Promise<void> {
    await this.transaction(async (client) => {
      await this.ensureUser(client, userId);
      const user = await client.query<{ balance: number }>(`
        SELECT balance::int AS balance FROM user_benefits WHERE user_id = $1 FOR UPDATE
      `, [userId]);
      const existing = await client.query<{ user_id: string; status: string }>(`
        SELECT user_id, status FROM job_credit_reservations WHERE job_id = $1
      `, [jobId]);
      if (existing.rows[0]) {
        if (existing.rows[0].user_id === userId && existing.rows[0].status !== 'refunded') return;
        throw new Error('Invalid credit reservation');
      }
      if (user.rows[0].balance < 1) throw new Error('No free uses remaining');

      const updated = await client.query<{ balance: number }>(`
        UPDATE user_benefits
        SET balance = balance - 1, last_active_at = NOW()
        WHERE user_id = $1
        RETURNING balance::int AS balance
      `, [userId]);
      await client.query(`
        INSERT INTO job_credit_reservations (job_id, user_id, status)
        VALUES ($1, $2, 'reserved')
      `, [jobId, userId]);
      await client.query(`
        INSERT INTO benefit_ledger (user_id, delta, balance_after, reason, reference_id)
        VALUES ($1, -1, $2, 'job_reserve', $3)
      `, [userId, updated.rows[0].balance, jobId]);
    });
  }

  async consume(jobId: string, userId: string): Promise<void> {
    await this.transaction(async (client) => {
      const reservation = await client.query<{ user_id: string; status: string }>(`
        SELECT user_id, status FROM job_credit_reservations WHERE job_id = $1 FOR UPDATE
      `, [jobId]);
      const state = reservation.rows[0];
      if (!state || state.user_id !== userId || state.status === 'refunded') throw new Error('Invalid credit reservation');
      if (state.status === 'consumed') return;
      await client.query(`
        UPDATE job_credit_reservations SET status = 'consumed', updated_at = NOW() WHERE job_id = $1
      `, [jobId]);
      await client.query(`
        UPDATE user_benefits SET last_active_at = NOW(), last_processed_at = NOW() WHERE user_id = $1
      `, [userId]);
    });
  }

  async refund(jobId: string, userId: string): Promise<void> {
    await this.transaction(async (client) => {
      const user = await client.query<{ balance: number }>(`
        SELECT balance::int AS balance FROM user_benefits WHERE user_id = $1 FOR UPDATE
      `, [userId]);
      const reservation = await client.query<{ user_id: string; status: string }>(`
        SELECT user_id, status FROM job_credit_reservations WHERE job_id = $1 FOR UPDATE
      `, [jobId]);
      const state = reservation.rows[0];
      if (!state || state.user_id !== userId) throw new Error('Invalid credit reservation');
      if (state.status !== 'reserved') return;
      if (user.rows[0].balance >= FREE_USE_CAP) throw new Error('Invalid benefit balance');

      const updated = await client.query<{ balance: number }>(`
        UPDATE user_benefits SET balance = balance + 1, last_active_at = NOW()
        WHERE user_id = $1 RETURNING balance::int AS balance
      `, [userId]);
      await client.query(`
        UPDATE job_credit_reservations SET status = 'refunded', updated_at = NOW() WHERE job_id = $1
      `, [jobId]);
      await client.query(`
        INSERT INTO benefit_ledger (user_id, delta, balance_after, reason, reference_id)
        VALUES ($1, 1, $2, 'job_refund', $3)
      `, [userId, updated.rows[0].balance, jobId]);
    });
  }

  private summary(state: Pick<UserState, 'balance' | 'checked_in_today'>): BenefitSummary {
    return {
      balance: state.balance,
      cap: FREE_USE_CAP,
      dailyReward: DAILY_REWARD,
      checkedInToday: state.checked_in_today,
    };
  }

  private async ensureUser(client: PoolClient, userId: string): Promise<void> {
    const inserted = await client.query<{ balance: number }>(`
      INSERT INTO user_benefits (user_id, balance)
      VALUES ($1, 1)
      ON CONFLICT (user_id) DO NOTHING
      RETURNING balance::int AS balance
    `, [userId]);
    if (inserted.rows[0]) {
      await client.query(`
        INSERT INTO benefit_ledger (user_id, delta, balance_after, reason, reference_id)
        VALUES ($1, 1, 1, 'first_use', $1)
      `, [userId]);
    }
    await client.query('UPDATE user_benefits SET last_active_at = NOW() WHERE user_id = $1', [userId]);
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
