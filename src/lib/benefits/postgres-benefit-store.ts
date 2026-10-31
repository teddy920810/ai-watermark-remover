import type { Pool, PoolClient } from 'pg';
import { consumePurchasedImageCredit, getPurchasedImageBalance, refundPurchasedImageCredit, reservePurchasedImageCredit } from '../payments/image-credit-wallet';
import type { ImageCreditCosts, ImageCreditOperation } from '../payments/image-credit-wallet';
import {
  DAILY_REWARD,
  FREE_USE_CAP,
  ImagePriceChangedError,
  type BenefitStore,
  type BenefitSummary,
  type CheckInResult,
  type ImageCreditConsent,
} from './benefit-store';

interface UserState {
  balance: number;
  checked_in_today: boolean;
  active_reservations: number;
}

export class PostgresBenefitStore implements BenefitStore {
  private readonly imageCosts: ImageCreditCosts;
  constructor(private readonly pool: Pool, private readonly paidCredits = false, private readonly environment: 'sandbox' | 'live' = 'sandbox', imageCosts: ImageCreditCosts = {}, private readonly priceVersion?: string) {
    if (Object.values(imageCosts).some((amount) => !Number.isSafeInteger(amount) || amount! < 1)) throw new Error('Invalid image credit amount');
    this.imageCosts = { ...imageCosts };
  }

  async getSummary(userId: string, email?: string): Promise<BenefitSummary> {
    const normalizedEmail = email?.trim().toLowerCase();
    const current = await this.readSummary(this.pool, userId);
    // Polling reads live entitlement without updating activity or identity.
    // First-use rewards and changed emails still use the existing transaction.
    if (current && (!normalizedEmail || current.identity_email === normalizedEmail)) return this.withPaid(this.pool, userId, this.summary(current));
    return this.transaction(async (client) => {
      await this.ensureUser(client, userId, normalizedEmail);
      const state = await this.readSummary(client, userId);
      if (!state) throw new Error('Benefit account is unavailable');
      return this.withPaid(client, userId, this.summary(state));
    });
  }

  async checkIn(userId: string, email?: string): Promise<CheckInResult> {
    return this.transaction(async (client) => {
      await this.ensureUser(client, userId, email);
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
            WHERE user_id = $1 AND status = 'reserved' ${this.paidCredits ? "AND source = 'free'" : ''}
          ) AS active_reservations
      `, [userId]);
      const state: UserState = { balance: user.rows[0].balance, ...activity.rows[0] };
      if (state.checked_in_today) {
        return this.withPaid(client, userId, { ...this.summary(state), granted: false, balanceFull: false });
      }
      if (state.balance + state.active_reservations >= FREE_USE_CAP) {
        return this.withPaid(client, userId, { ...this.summary(state), granted: false, balanceFull: true });
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
      return this.withPaid(client, userId, { balance, cap: FREE_USE_CAP, dailyReward: DAILY_REWARD, checkedInToday: true, granted: true, balanceFull: false });
    });
  }

  async reserve(jobId: string, userId: string, operation: ImageCreditOperation = 'watermark-removal', consent?: ImageCreditConsent): Promise<void> {
    await this.transaction(async (client) => {
      await this.ensureUser(client, userId);
      const user = await client.query<{ balance: number }>(`
        SELECT balance::int AS balance FROM user_benefits WHERE user_id = $1 FOR UPDATE
      `, [userId]);
      const existing = await client.query<{ user_id: string; status: string; source?: string }>(`
        SELECT user_id, status ${this.paidCredits ? ', source' : ''} FROM job_credit_reservations WHERE job_id = $1
      `, [jobId]);
      if (existing.rows[0]) {
        if (existing.rows[0].source === 'paid') {
          await reservePurchasedImageCredit(client, { jobId, ownerId: userId, environment: this.environment });
          return;
        }
        if (existing.rows[0].user_id === userId && existing.rows[0].status !== 'refunded') return;
        throw new Error('Invalid credit reservation');
      }
      if (user.rows[0].balance < 1) {
        if (this.paidCredits) {
          const amount = this.imageCosts[operation] ?? 1;
          if (this.priceVersion?.trim() && (!consent || consent.imageCostVersion !== this.priceVersion
            || !Number.isSafeInteger(consent.maxImageCredits) || consent.maxImageCredits < 1 || consent.maxImageCredits < amount)) throw new ImagePriceChangedError();
          if (await reservePurchasedImageCredit(client, { jobId, ownerId: userId, environment: this.environment, amount })) return;
        }
        throw new Error('No free uses remaining');
      }

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
      if (this.paidCredits) await client.query('SELECT user_id FROM user_benefits WHERE user_id=$1 FOR UPDATE', [userId]);
      const reservation = await client.query<{ user_id: string; status: string; source?: string }>(`
        SELECT user_id, status ${this.paidCredits ? ', source' : ''} FROM job_credit_reservations WHERE job_id = $1 FOR UPDATE
      `, [jobId]);
      const state = reservation.rows[0];
      if (state?.source === 'paid') {
        await consumePurchasedImageCredit(client, { jobId, ownerId: userId, environment: this.environment });
        return;
      }
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
      await client.query<{ balance: number }>(`
        SELECT balance::int AS balance FROM user_benefits WHERE user_id = $1 FOR UPDATE
      `, [userId]);
      const reservation = await client.query<{ user_id: string; status: string; source?: string }>(`
        SELECT user_id, status ${this.paidCredits ? ', source' : ''} FROM job_credit_reservations WHERE job_id = $1 FOR UPDATE
      `, [jobId]);
      const state = reservation.rows[0];
      if (state?.source === 'paid') {
        await refundPurchasedImageCredit(client, { jobId, ownerId: userId, environment: this.environment });
        return;
      }
      if (!state || state.user_id !== userId) throw new Error('Invalid credit reservation');
      if (state.status !== 'reserved') return;
      // A reward cap limits new grants, not returning an already reserved use.
      // Migration 005 permits this restoration without discarding user entitlement.

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

  private async readSummary(client: Pool | PoolClient, userId: string) {
    const result = await client.query<UserState & { identity_email: string | null }>(`
      SELECT
        balance::int AS balance,
        EXISTS (
          SELECT 1 FROM daily_checkins
          WHERE user_id = $1 AND checkin_date = (NOW() AT TIME ZONE 'UTC')::date
        ) AS checked_in_today,
        0::int AS active_reservations,
        (SELECT email FROM user_benefit_identities WHERE user_id = $1) AS identity_email
      FROM user_benefits
      WHERE user_id = $1
    `, [userId]);
    return result.rows[0];
  }

  private summary(state: Pick<UserState, 'balance' | 'checked_in_today'>): BenefitSummary {
    return {
      balance: state.balance,
      cap: FREE_USE_CAP,
      dailyReward: DAILY_REWARD,
      checkedInToday: state.checked_in_today,
    };
  }

  private async withPaid<T extends BenefitSummary>(client: Pick<PoolClient, 'query'>, userId: string, summary: T): Promise<T> {
    if (!this.paidCredits) return summary;
    const paidBalance = await getPurchasedImageBalance(client, userId, this.environment);
    return { ...summary, paidBalance };
  }

  private async ensureUser(client: PoolClient, userId: string, email?: string): Promise<void> {
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
    if (email) {
      await client.query(`
        INSERT INTO user_benefit_identities (user_id, email)
        VALUES ($1, $2)
        ON CONFLICT (user_id) DO UPDATE SET
          email = EXCLUDED.email,
          updated_at = NOW()
      `, [userId, email.trim().toLowerCase()]);
    }
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
