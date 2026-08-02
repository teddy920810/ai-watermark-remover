import type { Job } from './job';
import type { JobStore } from './job-store';

interface JsonObjects {
  putJson(key: string, value: unknown): Promise<void>;
  getJson<T>(key: string): Promise<T | null>;
}

export class R2JobStore implements JobStore {
  constructor(private readonly objects: JsonObjects) {}

  save(job: Job): Promise<void> {
    return this.objects.putJson(`jobs/${job.id}.json`, job);
  }

  get(id: string): Promise<Job | null> {
    return this.objects.getJson<Job>(`jobs/${id}.json`);
  }
}
