export type JobStatus = 'processing' | 'completed' | 'failed';

export interface Job {
  id: string;
  ownerId: string;
  status: JobStatus;
  inputKey: string;
  resultKey: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export function createJob(id: string, inputKey: string, ownerId: string, now = new Date().toISOString()): Job {
  return { id, ownerId, status: 'processing', inputKey, resultKey: null, error: null, createdAt: now, updatedAt: now };
}

export function finishJob(job: Job, resultKey: string, now = new Date().toISOString()): Job {
  return { ...job, status: 'completed', resultKey, error: null, updatedAt: now };
}

export function failJob(job: Job, error: string, now = new Date().toISOString()): Job {
  return { ...job, status: 'failed', resultKey: null, error, updatedAt: now };
}
