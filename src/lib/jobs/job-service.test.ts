import { describe, expect, it, vi } from 'vitest';
import type { Job } from './job';
import { JobService } from './job-service';

function createDependencies() {
  const jobs = new Map<string, Job>();
  return {
    jobStore: {
      save: vi.fn(async (job: Job) => void jobs.set(job.id, job)),
      get: vi.fn(async (id: string) => jobs.get(id) ?? null),
    },
    objects: { exists: vi.fn().mockResolvedValue(true) },
    provider: { remove: vi.fn().mockResolvedValue({ status: 'completed', resultKey: 'results/job-1.png' }) },
  };
}

describe('JobService', () => {
  it('rejects object keys outside uploads', async () => {
    const deps = createDependencies();
    const service = new JobService(deps, () => 'job-1');
    await expect(service.create('../private/file.png', 'google-user-1')).rejects.toThrow('Invalid upload key');
  });

  it('rejects an upload that does not exist', async () => {
    const deps = createDependencies();
    deps.objects.exists.mockResolvedValue(false);
    const service = new JobService(deps, () => 'job-1');
    await expect(service.create('uploads/eb8fa168-c11c-4e54-8c63-137d649ed1db.png', 'google-user-1')).rejects.toThrow('Upload not found');
  });

  it('persists processing then completed state', async () => {
    const deps = createDependencies();
    const service = new JobService(deps, () => 'job-1');
    const job = await service.create('uploads/eb8fa168-c11c-4e54-8c63-137d649ed1db.png', 'google-user-1');
    expect(deps.jobStore.save).toHaveBeenCalledTimes(2);
    expect(job).toMatchObject({ id: 'job-1', ownerId: 'google-user-1', status: 'completed', resultKey: 'results/job-1.png' });
  });

  it('persists a safe failure and does not leak provider details', async () => {
    const deps = createDependencies();
    deps.provider.remove.mockRejectedValue(new Error('secret provider response'));
    const service = new JobService(deps, () => 'job-1');
    const job = await service.create('uploads/eb8fa168-c11c-4e54-8c63-137d649ed1db.png', 'google-user-1');
    expect(job).toMatchObject({ status: 'failed', error: 'Image processing failed. Please try again.' });
  });
});
