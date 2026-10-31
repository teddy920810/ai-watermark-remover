import type { Job } from './job';

export type JobRequest = Omit<Job, 'resultKey' | 'error'> & { leaseExpiresAt: string };
export interface JobRequestStore {
  claim(job: Job): Promise<{ acquired: boolean; request: JobRequest }>;
  get(id: string): Promise<JobRequest | null>;
  recoverable(ownerId: string): Promise<JobRequest[]>;
  complete(id: string): Promise<JobRequest>;
  fail(id: string): Promise<JobRequest>;
  expire(id: string): Promise<JobRequest>;
  reservationStatus(id: string, ownerId: string): Promise<'reserved' | 'consumed' | 'refunded' | null>;
  /** Price refusal only: release an owned claim proven to have no financial records. */
  releaseUnreservedRequest(ownerId: string, id: string): Promise<void>;
}
