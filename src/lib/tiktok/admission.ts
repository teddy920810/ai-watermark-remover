import { randomUUID } from 'node:crypto';
import { resolverOperationCatalog } from '../contracts/operation-catalog';

export interface TikTokAdmission {
  acquire(): Promise<string | null>;
  release(lease: string): Promise<void>;
}
interface Database { query(sql: string, values?: unknown[]): Promise<{ rows: unknown[] }> }

/** A single PostgreSQL row bounds all instances without another service or user data. */
export function createTikTokAdmission(db: Database): TikTokAdmission {
  const policy = resolverOperationCatalog['tiktok-video-resolve'];
  return {
    async acquire() {
      const lease = randomUUID();
      const result = await db.query(`
        INSERT INTO tiktok_admission (id, lease, active_until, next_start, day_start, daily_count)
        VALUES (1, $1, statement_timestamp() + $2 * interval '1 millisecond',
          statement_timestamp() + $3 * interval '1 millisecond', (statement_timestamp() AT TIME ZONE 'UTC')::date, 1)
        ON CONFLICT (id) DO UPDATE SET lease = EXCLUDED.lease, active_until = EXCLUDED.active_until,
          next_start = EXCLUDED.next_start, day_start = EXCLUDED.day_start,
          daily_count = CASE WHEN tiktok_admission.day_start = EXCLUDED.day_start THEN tiktok_admission.daily_count + 1 ELSE 1 END
        WHERE tiktok_admission.active_until <= statement_timestamp() AND tiktok_admission.next_start <= statement_timestamp()
          AND (tiktok_admission.day_start <> EXCLUDED.day_start OR tiktok_admission.daily_count < $4)
        RETURNING id`, [lease, policy.timeoutMs + 5000, policy.minIntervalMs, policy.maxDailyResolves]);
      return result.rows.length ? lease : null;
    },
    async release(lease) {
      await db.query('UPDATE tiktok_admission SET active_until = statement_timestamp() WHERE id = 1 AND lease = $1', [lease]);
    },
  };
}
