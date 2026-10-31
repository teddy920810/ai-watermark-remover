import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Job, JobStatus, ProcessingOperation } from './job';
import type { JobRequest, JobRequestStore } from './job-request-store';

interface RequestRow {
  job_id: string; owner_id: string; input_key: string; mask_key: string | null;
  operation: ProcessingOperation; status: JobStatus;
  created_at: Date; updated_at: Date; lease_expires_at: Date;
}
function request(row: RequestRow): JobRequest {
  return {
    id: row.job_id, ownerId: row.owner_id, inputKey: row.input_key, maskKey: row.mask_key,
    operation: row.operation, status: row.status, createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(), leaseExpiresAt: new Date(row.lease_expires_at).toISOString(),
  };
}

export class PostgresJobRequestStore implements JobRequestStore {
  constructor(private readonly pool: Pool, private readonly environment: 'sandbox' | 'live' = 'sandbox') {}

  async claim(job: Job): Promise<{ acquired: boolean; request: JobRequest }> {
    const hash = createHash('sha256').update(JSON.stringify([job.ownerId, job.inputKey, job.operation, job.maskKey])).digest('hex');
    return this.transaction(async (client) => {
      // ON CONFLICT serializes competing inserts. The subsequent SELECT uses a
      // fresh statement snapshot, including the winning transaction's row.
      const inserted = await client.query<RequestRow>(`
        INSERT INTO processing_requests(job_id,environment,owner_id,request_hash,input_key,mask_key,operation)
        VALUES($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT(environment,owner_id,request_hash) DO NOTHING RETURNING *
      `, [job.id, this.environment, job.ownerId, hash, job.inputKey, job.maskKey, job.operation]);
      const row = inserted.rows[0] ?? (await client.query<RequestRow>(`
        SELECT * FROM processing_requests WHERE environment=$1 AND owner_id=$2 AND request_hash=$3
      `, [this.environment, job.ownerId, hash])).rows[0];
      if (!row) throw new Error('Unable to claim processing request');
      return { acquired: inserted.rows.length === 1, request: request(row) };
    });
  }

  get(id: string): Promise<JobRequest | null> {
    return this.transaction(async (client) => {
      const result = await client.query<RequestRow>('SELECT * FROM processing_requests WHERE job_id=$1 AND environment=$2', [id, this.environment]);
      return result.rows[0] ? request(result.rows[0]) : null;
    });
  }

  recoverable(ownerId: string): Promise<JobRequest[]> {
    return this.transaction(async (client) => {
      const result = await client.query<RequestRow>(`
        SELECT p.* FROM processing_requests p
        LEFT JOIN job_credit_reservations r ON r.job_id=p.job_id AND r.user_id=p.owner_id
        LEFT JOIN paid_credit_lots l ON l.id=r.lot_id
        LEFT JOIN payment_orders o ON o.id=l.order_id
        WHERE p.environment=$1 AND p.owner_id=$2 AND (
          (p.status='processing' AND p.lease_expires_at <= NOW()) OR
          (p.status IN ('completed','failed') AND r.status='reserved' AND (r.source='free' OR o.environment=$1))
        ) ORDER BY p.updated_at,p.job_id LIMIT 20
      `, [this.environment, ownerId]);
      return result.rows.map(request);
    });
  }

  complete(id: string): Promise<JobRequest> {
    return this.transition(id, "status='processing' AND lease_expires_at > NOW()", 'completed');
  }
  fail(id: string): Promise<JobRequest> { return this.transition(id, "status='processing'", 'failed'); }
  expire(id: string): Promise<JobRequest> {
    return this.transition(id, "status='processing' AND lease_expires_at <= NOW()", 'failed');
  }

  reservationStatus(id: string, ownerId: string): Promise<'reserved' | 'consumed' | 'refunded' | null> {
    return this.transaction(async (client) => {
      const result = await client.query<{ status: 'reserved' | 'consumed' | 'refunded' }>(`
        SELECT r.status FROM job_credit_reservations r
        JOIN processing_requests p ON p.job_id=r.job_id AND p.owner_id=r.user_id AND p.environment=$3
        LEFT JOIN paid_credit_lots l ON l.id=r.lot_id
        LEFT JOIN payment_orders o ON o.id=l.order_id
        WHERE r.job_id=$1 AND r.user_id=$2 AND (r.source='free' OR o.environment=$3)
      `, [id, ownerId, this.environment]);
      return result.rows[0]?.status ?? null;
    });
  }

  releaseUnreservedRequest(ownerId: string, id: string): Promise<void> {
    return this.transaction(async (client) => {
      // Match the benefit store's owner-first lock order. A reservation already
      // committing on this owner must become visible before the financial check.
      const owner = await client.query('SELECT user_id FROM user_benefits WHERE user_id=$1 FOR UPDATE', [ownerId]);
      if (!owner.rows[0]) throw new Error('Unadmitted request cannot be released');
      const claim = await client.query<{ status: JobStatus }>('SELECT status FROM processing_requests WHERE job_id=$1 AND owner_id=$2 AND environment=$3 FOR UPDATE', [id, ownerId, this.environment]);
      if (claim.rows[0]?.status !== 'processing') throw new Error('Unadmitted request cannot be released');
      const financial = await client.query<{ exists: boolean }>(`
        SELECT EXISTS (
          SELECT 1 FROM job_credit_reservations WHERE job_id=$1
          UNION ALL SELECT 1 FROM processing_admissions WHERE job_id=$1
          UNION ALL SELECT 1 FROM processing_credit_ledger WHERE reference_id=$1 AND reason IN ('reserve','settle','refund')
          UNION ALL SELECT 1 FROM benefit_ledger WHERE reference_id=$1 AND reason IN ('job_reserve','job_refund')
          UNION ALL SELECT 1 FROM paid_credit_ledger WHERE reference_id=$1 AND reason IN ('job_reserve','job_refund','job_refund_frozen')
        ) AS exists
      `, [id]);
      if (financial.rows[0]?.exists !== false) throw new Error('Financial request cannot be released');
      const deleted = await client.query("DELETE FROM processing_requests WHERE job_id=$1 AND owner_id=$2 AND environment=$3 AND status='processing'", [id, ownerId, this.environment]);
      if (deleted.rowCount !== 1) throw new Error('Unadmitted request cannot be released');
    });
  }

  private transition(id: string, condition: string, status: 'completed' | 'failed'): Promise<JobRequest> {
    // The condition is a private literal chosen above, never request input.
    return this.transaction(async (client) => {
      await client.query(`UPDATE processing_requests SET status=$3,updated_at=NOW() WHERE job_id=$1 AND environment=$2 AND ${condition}`, [id, this.environment, status]);
      const result = await client.query<RequestRow>('SELECT * FROM processing_requests WHERE job_id=$1 AND environment=$2', [id, this.environment]);
      if (!result.rows[0]) throw new Error('Job request not found');
      return request(result.rows[0]);
    });
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
    } finally { client.release(); }
  }
}
