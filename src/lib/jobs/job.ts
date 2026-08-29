import { z } from 'zod';

export const processingOperationSchema = z.enum(['watermark-removal', 'background-removal']);
export type ProcessingOperation = z.infer<typeof processingOperationSchema>;
export type JobStatus = 'processing' | 'completed' | 'failed';

export interface Job {
  id: string;
  ownerId: string;
  operation: ProcessingOperation;
  status: JobStatus;
  inputKey: string;
  resultKey: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export function createJob(
  id: string,
  inputKey: string,
  ownerId: string,
  now = new Date().toISOString(),
  operation: ProcessingOperation = 'watermark-removal',
): Job {
  return { id, ownerId, operation, status: 'processing', inputKey, resultKey: null, error: null, createdAt: now, updatedAt: now };
}

export function finishJob(job: Job, resultKey: string, now = new Date().toISOString()): Job {
  return { ...job, status: 'completed', resultKey, error: null, updatedAt: now };
}

export function failJob(job: Job, error: string, now = new Date().toISOString()): Job {
  return { ...job, status: 'failed', resultKey: null, error, updatedAt: now };
}
