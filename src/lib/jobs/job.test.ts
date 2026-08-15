import { describe, expect, it } from 'vitest';
import { createJob, failJob, finishJob } from './job';

describe('job lifecycle', () => {
  it('creates a processing job without a result', () => {
    const job = createJob('job-1', 'uploads/input.png', 'google-user-1', '2026-08-02T00:00:00.000Z');
    expect(job).toMatchObject({ id: 'job-1', ownerId: 'google-user-1', status: 'processing', resultKey: null });
  });

  it('finishes a processing job', () => {
    const job = createJob('job-1', 'uploads/input.png', 'google-user-1', '2026-08-02T00:00:00.000Z');
    expect(finishJob(job, 'results/job-1.png', '2026-08-02T00:00:01.000Z')).toMatchObject({ status: 'completed', resultKey: 'results/job-1.png' });
  });

  it('records a safe failure message', () => {
    const job = createJob('job-1', 'uploads/input.png', 'google-user-1', '2026-08-02T00:00:00.000Z');
    expect(failJob(job, 'Processing failed', '2026-08-02T00:00:01.000Z')).toMatchObject({ status: 'failed', error: 'Processing failed' });
  });
});
