import { describe, expect, it, vi } from 'vitest';
import { createJob, finishJob, type Job } from './job';
import { JobService } from './job-service';
import { ImagePriceChangedError } from '../benefits/benefit-store';

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

function createDurableDependencies() {
  const deps = createDependencies();
  type Request = Omit<Job, 'resultKey' | 'error'> & { leaseExpiresAt: string };
  const records = new Map<string, Request>();
  const keys = new Map<string, string>();
  const expired = new Set<string>();
  const reservations = new Map<string, 'reserved' | 'consumed' | 'refunded'>();
  deps.benefits.reserve.mockImplementation(async (id: string) => { reservations.set(id, 'reserved'); });
  deps.benefits.consume.mockImplementation(async (id: string) => { reservations.set(id, 'consumed'); });
  deps.benefits.refund.mockImplementation(async (id: string) => { reservations.set(id, 'refunded'); });
  const requests = {
    claim: vi.fn(async (job: Job) => {
      const key = JSON.stringify([job.ownerId, job.inputKey, job.operation, job.maskKey]);
      const existing = keys.get(key);
      if (existing) return { acquired: false, request: records.get(existing)! };
      const { resultKey: _result, error: _error, ...identity } = job;
      void _result; void _error;
      const request = { ...identity, leaseExpiresAt: new Date(Date.now() + 900_000).toISOString() };
      keys.set(key, job.id); records.set(job.id, request);
      return { acquired: true, request };
    }),
    get: vi.fn(async (id: string) => records.get(id) ?? null),
    complete: vi.fn(async (id: string) => {
      const record = records.get(id)!;
      if (record.status === 'processing' && !expired.has(id)) record.status = 'completed';
      return record;
    }),
    fail: vi.fn(async (id: string) => {
      const record = records.get(id)!;
      if (record.status === 'processing') record.status = 'failed';
      return record;
    }),
    expire: vi.fn(async (id: string) => {
      const record = records.get(id)!;
      if (record.status === 'processing' && expired.has(id)) record.status = 'failed';
      return record;
    }),
    reservationStatus: vi.fn(async (id: string) => reservations.get(id) ?? null),
    releaseUnreservedRequest: vi.fn(async (ownerId: string, id: string) => {
      const record = records.get(id);
      if (!record || record.ownerId !== ownerId || record.status !== 'processing' || reservations.has(id)) throw new Error('Unadmitted request cannot be released');
      records.delete(id);
      keys.delete(JSON.stringify([record.ownerId, record.inputKey, record.operation, record.maskKey]));
    }),
    recoverable: vi.fn(async (ownerId: string) => [...records.values()].filter((record) => record.ownerId === ownerId && (
      (record.status === 'processing' && expired.has(record.id)) ||
      (record.status !== 'processing' && reservations.get(record.id) === 'reserved')
    )).slice(0, 20)),
  };
  return { ...deps, requests, expired, records };
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
    expect(deps.benefits.reserve).toHaveBeenCalledWith('job-1', 'google-user-1', 'watermark-removal');
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
    expect(deps.benefits.reserve).toHaveBeenCalledWith('job-1', 'google-user-1', 'background-removal');
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
    expect(deps.benefits.reserve).toHaveBeenCalledWith('job-1', 'google-user-1', 'object-removal');
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

  it('claims the same upload once across service instances and returns the existing processing job', async () => {
    const deps = createDurableDependencies();
    let finish = (_value: { status: string; resultKey: string }) => {};
    deps.providers['watermark-removal'].remove.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const first = new JobService(deps, () => 'job-1').create(inputKey, 'google-user-1');
    await vi.waitFor(() => expect(deps.providers['watermark-removal'].remove).toHaveBeenCalledTimes(1));
    const duplicate = await new JobService(deps, () => 'job-2').create(inputKey, 'google-user-1');
    expect(duplicate).toMatchObject({ id: 'job-1', status: 'processing' });
    expect(deps.benefits.reserve).toHaveBeenCalledTimes(1);
    expect(deps.providers['watermark-removal'].remove).toHaveBeenCalledTimes(1);
    finish({ status: 'completed', resultKey: 'results/job-1.png' });
    await expect(first).resolves.toMatchObject({ status: 'completed' });
    await expect(new JobService(deps).create(inputKey, 'google-user-1')).resolves.toMatchObject({ id: 'job-1', status: 'completed' });
    expect(deps.providers['watermark-removal'].remove).toHaveBeenCalledTimes(1);
    expect(deps.objects.delete).not.toHaveBeenCalled();
  });

  it('replays terminal failed requests even after input cleanup instead of charging or processing again', async () => {
    const deps = createDurableDependencies();
    deps.providers['watermark-removal'].remove.mockRejectedValue(new Error('Provider failed'));
    const service = new JobService(deps, () => 'job-1');
    await expect(service.create(inputKey, 'google-user-1')).resolves.toMatchObject({ id: 'job-1', status: 'failed' });
    deps.objects.head.mockResolvedValue(null);
    await expect(service.create(inputKey, 'google-user-1')).resolves.toMatchObject({ id: 'job-1', status: 'failed' });
    expect(deps.providers['watermark-removal'].remove).toHaveBeenCalledTimes(1);
    expect(deps.benefits.reserve).toHaveBeenCalledTimes(1);
    expect(deps.benefits.refund).toHaveBeenCalledTimes(1);
  });
  it.each(['watermark-removal', 'background-removal', 'object-removal'] as const)('passes the durable %s operation to reservation once and keeps retries on its original snapshot', async (operation) => {
    const deps = createDurableDependencies();
    const service = new JobService(deps, () => 'job-1');
    const selection = operation === 'object-removal' ? maskKey : undefined;
    await expect(service.create(inputKey, 'google-user-1', operation, selection)).resolves.toMatchObject({ id: 'job-1', status: 'completed' });
    await expect(new JobService(deps, () => 'job-2').create(inputKey, 'google-user-1', operation, selection)).resolves.toMatchObject({ id: 'job-1', status: 'completed' });
    expect(deps.benefits.reserve).toHaveBeenCalledExactlyOnceWith('job-1', 'google-user-1', operation);
    expect(deps.providers[operation].remove).toHaveBeenCalledTimes(1);
  });
  it('passes price consent to the first paid reservation, preserves uploads on rejection and waits for a new user-confirmed attempt', async () => {
    const deps = createDurableDependencies();
    deps.benefits.reserve.mockRejectedValueOnce(new ImagePriceChangedError());
    const oldConsent = { imageCostVersion: 'costs-v1', maxImageCredits: 100 };
    await expect(new JobService(deps, () => 'job-old').create(inputKey, 'google-user-1', 'object-removal', maskKey, oldConsent)).rejects.toBeInstanceOf(ImagePriceChangedError);
    expect(deps.requests.releaseUnreservedRequest).toHaveBeenCalledExactlyOnceWith('google-user-1', 'job-old');
    expect(deps.objects.delete).not.toHaveBeenCalled();
    expect(deps.providers['object-removal'].remove).not.toHaveBeenCalled();
    const currentConsent = { imageCostVersion: 'costs-v2', maxImageCredits: 340 };
    await expect(new JobService(deps, () => 'job-new').create(inputKey, 'google-user-1', 'object-removal', maskKey, currentConsent)).resolves.toMatchObject({ id: 'job-new', status: 'completed' });
    expect(deps.benefits.reserve).toHaveBeenLastCalledWith('job-new', 'google-user-1', 'object-removal', currentConsent);
    // Accepted retries use their original financial snapshot even without a new ACK.
    await expect(new JobService(deps, () => 'job-duplicate').create(inputKey, 'google-user-1', 'object-removal', maskKey)).resolves.toMatchObject({ id: 'job-new', status: 'completed' });
    expect(deps.benefits.reserve).toHaveBeenCalledTimes(2);
    expect(deps.benefits.consume).toHaveBeenCalledOnce();
    expect(deps.providers['object-removal'].remove).toHaveBeenCalledOnce();
  });
  it('keeps uploads and returns a recoverable service failure when releasing a rejected price claim fails', async () => {
    const deps = createDurableDependencies();
    deps.benefits.reserve.mockRejectedValueOnce(new ImagePriceChangedError());
    deps.requests.releaseUnreservedRequest.mockRejectedValueOnce(new Error('Request release unavailable'));
    await expect(new JobService(deps, () => 'job-price').create(inputKey, 'google-user-1', 'watermark-removal', undefined, { imageCostVersion: 'costs-v1', maxImageCredits: 100 })).rejects.toThrow('Request release unavailable');
    expect(deps.records.get('job-price')?.status).toBe('processing');
    expect(deps.objects.delete).not.toHaveBeenCalled();
    expect(deps.providers['watermark-removal'].remove).not.toHaveBeenCalled();
    expect(deps.benefits.refund).not.toHaveBeenCalled();
  });

  it('recovers a crashed reservation after its lease expires and refunds only once', async () => {
    const deps = createDurableDependencies();
    await deps.requests.claim(createJob('job-1', inputKey, 'google-user-1'));
    await deps.benefits.reserve('job-1', 'google-user-1');
    deps.expired.add('job-1');
    const service = new JobService(deps);
    await expect(service.get('job-1', 'google-user-1')).resolves.toMatchObject({ status: 'failed' });
    await expect(service.get('job-1', 'google-user-1')).resolves.toMatchObject({ status: 'failed' });
    expect(deps.benefits.refund).toHaveBeenCalledTimes(1);
    expect(deps.providers['watermark-removal'].remove).not.toHaveBeenCalled();
  });

  it('keeps a completed artifact and recovers a failed credit consume without refunding it', async () => {
    const deps = createDurableDependencies();
    deps.benefits.consume.mockRejectedValueOnce(new Error('Database temporarily unavailable'));
    const service = new JobService(deps, () => 'job-1');
    await expect(service.create(inputKey, 'google-user-1')).rejects.toThrow('Database temporarily unavailable');
    expect(deps.benefits.refund).not.toHaveBeenCalled();
    expect(deps.objects.delete).not.toHaveBeenCalled();
    await expect(service.get('job-1', 'google-user-1')).resolves.toMatchObject({ status: 'completed', resultKey: 'results/job-1.png' });
    expect(deps.providers['watermark-removal'].remove).toHaveBeenCalledTimes(1);
    expect(deps.benefits.consume).toHaveBeenCalledTimes(2);
  });

  it('finishes credit consumption after a crash between the R2 result save and durable completion', async () => {
    const deps = createDurableDependencies();
    const job = createJob('job-1', inputKey, 'google-user-1');
    await deps.requests.claim(job);
    await deps.benefits.reserve(job.id, job.ownerId);
    await deps.jobStore.save(finishJob(job, 'results/job-1.png'));
    await expect(new JobService(deps).get(job.id, job.ownerId)).resolves.toMatchObject({ status: 'completed' });
    expect(deps.records.get(job.id)?.status).toBe('completed');
    expect(deps.benefits.consume).toHaveBeenCalledTimes(1);
    expect(deps.providers['watermark-removal'].remove).not.toHaveBeenCalled();
  });

  it('does not recover or mutate a job for another owner', async () => {
    const deps = createDurableDependencies();
    await deps.requests.claim(createJob('job-1', inputKey, 'google-user-1'));
    await deps.benefits.reserve('job-1', 'google-user-1');
    deps.expired.add('job-1');
    await expect(new JobService(deps).get('job-1', 'another-user')).resolves.toBeNull();
    expect(deps.requests.expire).not.toHaveBeenCalled();
    expect(deps.benefits.refund).not.toHaveBeenCalled();
    expect(deps.objects.delete).not.toHaveBeenCalled();
  });

  it('does not start a provider or reserve credits after a slow input check outlives the claim', async () => {
    const deps = createDurableDependencies();
    let releaseHead = (_value: { contentLength: number; contentType: string }) => {};
    deps.objects.head.mockImplementationOnce(() => new Promise((resolve) => { releaseHead = resolve; }));
    const service = new JobService(deps, () => 'job-1');
    const first = service.create(inputKey, 'google-user-1');
    await vi.waitFor(() => expect(deps.objects.head).toHaveBeenCalledOnce());
    deps.expired.add('job-1');
    await expect(new JobService(deps).create(inputKey, 'google-user-1')).resolves.toMatchObject({ status: 'failed' });
    releaseHead({ contentLength: 68, contentType: 'image/png' });
    await expect(first).resolves.toMatchObject({ status: 'failed' });
    expect(deps.benefits.reserve).not.toHaveBeenCalled();
    expect(deps.providers['watermark-removal'].remove).not.toHaveBeenCalled();
  });

  it('retries a failed credit refund while preserving the failed terminal request', async () => {
    const deps = createDurableDependencies();
    deps.providers['watermark-removal'].remove.mockRejectedValue(new Error('Provider failed'));
    deps.benefits.refund.mockRejectedValueOnce(new Error('Refund database unavailable'));
    const service = new JobService(deps, () => 'job-1');
    await expect(service.create(inputKey, 'google-user-1')).rejects.toThrow('Refund database unavailable');
    expect(deps.records.get('job-1')?.status).toBe('failed');
    await expect(service.get('job-1', 'google-user-1')).resolves.toMatchObject({ status: 'failed' });
    expect(deps.benefits.refund).toHaveBeenCalledTimes(2);
    expect(deps.providers['watermark-removal'].remove).toHaveBeenCalledTimes(1);
  });

  it('does not refund consumed credits or reprocess after the temporary result expires', async () => {
    const deps = createDurableDependencies();
    const service = new JobService(deps, () => 'job-1');
    await service.create(inputKey, 'google-user-1');
    deps.jobStore.get.mockResolvedValue(null);
    await expect(service.get('job-1', 'google-user-1')).resolves.toMatchObject({ status: 'failed', error: 'Result expired. Please upload the image again.' });
    expect(deps.benefits.refund).not.toHaveBeenCalled();
    expect(deps.providers['watermark-removal'].remove).toHaveBeenCalledTimes(1);
  });

  it('recovers only this account abandoned requests while leaving active leases and other accounts alone', async () => {
    const deps = createDurableDependencies();
    for (const [id, owner] of [['old', 'google-user-1'], ['active', 'google-user-1'], ['another', 'another-user']]) {
      await deps.requests.claim(createJob(id, `${inputKey}-${id}`, owner));
      await deps.benefits.reserve(id, owner);
    }
    deps.expired.add('old'); deps.expired.add('another');
    await new JobService(deps).recoverUser('google-user-1');
    expect(deps.benefits.refund).toHaveBeenCalledExactlyOnceWith('old', 'google-user-1');
    expect(deps.records.get('active')?.status).toBe('processing');
    expect(deps.records.get('another')?.status).toBe('processing');
    expect(deps.providers['watermark-removal'].remove).not.toHaveBeenCalled();
  });

  it('continues bounded recovery after one settlement failure and retries that failure on the next balance read', async () => {
    const deps = createDurableDependencies();
    for (const id of ['first', 'second']) {
      await deps.requests.claim(createJob(id, `${inputKey}-${id}`, 'google-user-1'));
      await deps.benefits.reserve(id, 'google-user-1');
      deps.expired.add(id);
    }
    deps.benefits.refund.mockRejectedValueOnce(new Error('Temporary database error'));
    const service = new JobService(deps);
    await expect(service.recoverUser('google-user-1')).rejects.toThrow('Processing credits are temporarily unavailable');
    expect(deps.benefits.refund).toHaveBeenCalledTimes(2);
    await expect(service.recoverUser('google-user-1')).resolves.toBeUndefined();
    expect(deps.benefits.refund).toHaveBeenCalledTimes(3);
    expect(deps.providers['watermark-removal'].remove).not.toHaveBeenCalled();
  });

  it('keeps account recovery a no-op when durable paid processing is disabled', async () => {
    const deps = createDependencies();
    await expect(new JobService(deps).recoverUser('google-user-1')).resolves.toBeUndefined();
    expect(deps.jobStore.get).not.toHaveBeenCalled();
    expect(deps.benefits.refund).not.toHaveBeenCalled();
  });
});
