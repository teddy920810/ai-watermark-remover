import type { Job } from './job';

export interface JobStore {
  save(job: Job): Promise<void>;
  get(id: string): Promise<Job | null>;
}
