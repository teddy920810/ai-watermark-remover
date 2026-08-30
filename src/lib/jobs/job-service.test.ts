import { describe, expect, it, vi } from 'vitest';
import type { Job } from './job';
import { JobService } from './job-service';

function createDependencies() {
  const jobs = new Map<string, Job>();
  const watermarkProvider = { remove: vi.fn().mockResolvedValue({ status: 'completed', resultKey: 'results/job-1.png' }) };
  const backgroundProvider = { remove: vi.fn().mockResolvedValue({ status: 'completed', resultKey: 'results/background/job-1.png' }) };
  const objectProvider = { remove: vi.fn().mockResolvedValue({ status: 'completed', resultKey: 'results/object/job-1.png' }) };
  return {
    jobStore: {
      save: vi.fn(async (job: Job) => void jobs.set(job.id, job)),
      get: vi.fn(async (id: string) => jobs.get(id) ?? null),
    },
    objects: {
      head: vi.fn().mockResolvedValue({ contentLength: 68, contentType: 'image/png' }),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    providers: {
      'watermark-removal': watermarkProvider,
      'background-removal': backgroundProvider,
      'object-removal': objectProvider,
    },
    benefits: {
      reserve: vi.fn().mockResolvedValue(undefined),
      consume: vi.fn().mockResolvedValue(undefined),
      refund: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe('JobService', () => {
  const inputKey = 'uploads/users/5bd39a3d505d21099461dc1b7a3f4d9f/eb8fa168-c11c-4e54-8c63-137d649ed1db.png';
  const maskKey = 'uploads/users/5bd39a3d505d21099461dc1b7a3f4d9f/8e7756b9-05e5-453a-a477-fca1f0a66846.png';

  it('rejects object keys outside uploads', async () => {
    const deps = createDependencies();
    const service = new JobService(deps, () => 'job-1');
    await expect(service.create('../private/file.png', 'google-user-1')).rejects.toThrow('Invalid upload key');
  });

  it('hides uploads belonging to another user', async () => {
    const deps = createDependencies();
    const service = new JobService(deps, () => 'job-1');
    await expect(service.create(
      'uploads/users/00000000000000000000000000000000/eb8fa168-c11c-4e54-8c63-137d649ed1db.png',
      'google-user-1',
    )).rejects.toThrow('Upload not found');
    expect(deps.objects.head).not.toHaveBeenCalled();
  });

  it('rejects an upload that does not exist', async () => {
    const deps = createDependencies();
    deps.objects.head.mockResolvedValue(null);
    const service = new JobService(deps, () => 'job-1');
    await expect(service.create(inputKey, 'google-user-1')).rejects.toThrow('Upload not found');
  });

  it.each([
    { contentLength: 0, contentType: 'image/png' },
    { contentLength: 68, contentType: 'text/plain' },
  ])('rejects and cleans up untrusted uploaded metadata %#', async (metadata) => {
    const deps = createDependencies();
    deps.objects.head.mockResolvedValue(metadata);
    const service = new JobService(deps, () => 'job-1');
    await expect(service.create(inputKey, 'google-user-1')).rejects.toThrow('Invalid uploaded image');
    expect(deps.objects.delete).toHaveBeenCalledWith(inputKey);
  });

  it('persists processing then completed state', async () => {
    const deps = createDependencies();
    const service = new JobService(deps, () => 'job-1');
    const job = await service.create(inputKey, 'google-user-1');
    expect(deps.jobStore.save).toHaveBeenCalledTimes(2);
    expect(deps.benefits.reserve).toHaveBeenCalledWith('job-1', 'google-user-1');
    expect(deps.benefits.consume).toHaveBeenCalledWith('job-1', 'google-user-1');
    expect(deps.benefits.refund).not.toHaveBeenCalled();
    expect(job).toMatchObject({
      id: 'job-1', ownerId: 'google-user-1', operation: 'watermark-removal', status: 'completed', resultKey: 'results/job-1.png',
    });
  });

  it('routes background removal through its provider while sharing the same credit reservation', async () => {
    const deps = createDependencies();
    const service = new JobService(deps, () => 'job-1');
    const job = await service.create(inputKey, 'google-user-1', 'background-removal');

    expect(deps.providers['background-removal'].remove).toHaveBeenCalledWith({ jobId: 'job-1', inputKey });
    expect(deps.providers['watermark-removal'].remove).not.toHaveBeenCalled();
    expect(deps.benefits.reserve).toHaveBeenCalledWith('job-1', 'google-user-1');
    expect(deps.benefits.consume).toHaveBeenCalledWith('job-1', 'google-user-1');
    expect(job).toMatchObject({
      operation: 'background-removal', status: 'completed', resultKey: 'results/background/job-1.png',
    });
  });

  it('validates and routes the source and mask while sharing one credit reservation', async () => {
    const deps = createDependencies();
    const service = new JobService(deps, () => 'job-1');
    const job = await service.create(inputKey, 'google-user-1', 'object-removal', maskKey);

    expect(deps.objects.head).toHaveBeenNthCalledWith(1, inputKey);
    expect(deps.objects.head).toHaveBeenNthCalledWith(2, maskKey);
    expect(deps.providers['object-removal'].remove).toHaveBeenCalledWith({ jobId: 'job-1', inputKey, maskKey });
    expect(deps.providers['watermark-removal'].remove).not.toHaveBeenCalled();
    expect(deps.providers['background-removal'].remove).not.toHaveBeenCalled();
    expect(deps.benefits.reserve).toHaveBeenCalledTimes(1);
    expect(deps.benefits.consume).toHaveBeenCalledTimes(1);
    expect(job).toMatchObject({ operation: 'object-removal', maskKey, resultKey: 'results/object/job-1.png' });
  });

  it('rejects an object-removal mask that does not belong to the same user', async () => {
    const deps = createDependencies();
    const service = new JobService(deps, () => 'job-1');
    await expect(service.create(
      inputKey,
      'google-user-1',
      'object-removal',
      'uploads/users/00000000000000000000000000000000/8e7756b9-05e5-453a-a477-fca1f0a66846.png',
    )).rejects.toThrow('Mask not found');
    expect(deps.benefits.reserve).not.toHaveBeenCalled();
  });

  it('cleans up both object-removal inputs when processing fails', async () => {
    const deps = createDependencies();
    deps.providers['object-removal'].remove.mockRejectedValue(new Error('secret provider response'));
    const service = new JobService(deps, () => 'job-1');
    await expect(service.create(inputKey, 'google-user-1', 'object-removal', maskKey)).resolves.toMatchObject({ status: 'failed' });
    expect(deps.objects.delete).toHaveBeenCalledWith(inputKey);
    expect(deps.objects.delete).toHaveBeenCalledWith(maskKey);
  });

  it('persists a safe failure and does not leak provider details', async () => {
    const deps = createDependencies();
    deps.providers['watermark-removal'].remove.mockRejectedValue(new Error('secret provider response'));
    const service = new JobService(deps, () => 'job-1');
    const job = await service.create(inputKey, 'google-user-1');
    expect(job).toMatchObject({ status: 'failed', error: 'Image processing failed. Please try again.' });
    expect(deps.benefits.refund).toHaveBeenCalledWith('job-1', 'google-user-1');
    expect(deps.objects.delete).toHaveBeenCalledWith(inputKey);
  });

  it('does not call the provider and cleans up the upload when no free uses remain', async () => {
    const deps = createDependencies();
    deps.benefits.reserve.mockRejectedValue(new Error('No free uses remaining'));
    const service = new JobService(deps, () => 'job-1');
    await expect(service.create(inputKey, 'google-user-1')).rejects.toThrow('No free uses remaining');
    expect(deps.providers['watermark-removal'].remove).not.toHaveBeenCalled();
    expect(deps.providers['background-removal'].remove).not.toHaveBeenCalled();
    expect(deps.providers['object-removal'].remove).not.toHaveBeenCalled();
    expect(deps.objects.delete).toHaveBeenCalledWith(inputKey);
  });

  it('keeps the safe failure even when orphan cleanup also fails', async () => {
    const deps = createDependencies();
    deps.providers['watermark-removal'].remove.mockRejectedValue(new Error('secret provider response'));
    deps.objects.delete.mockRejectedValue(new Error('secret object-store response'));
    const service = new JobService(deps, () => 'job-1');
    await expect(service.create(inputKey, 'google-user-1')).resolves.toMatchObject({
      status: 'failed', error: 'Image processing failed. Please try again.',
    });
  });
});
