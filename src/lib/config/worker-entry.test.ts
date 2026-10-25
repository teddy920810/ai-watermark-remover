import { describe, expect, it, vi } from 'vitest';
import { runWorker, workerConfigFromEnvironment } from '../../../apps/worker/entry';
import type { ProcessingRuntime } from '../runtime/processing-services';

const environment = { MODE: 'process', JOB_ID: 'job-1', OWNER_ID: 'owner-1', R2_ENDPOINT: 'https://r2.example.test', R2_ACCESS_KEY_ID: 'private-access', R2_SECRET_ACCESS_KEY: 'private-secret', R2_BUCKET: 'private', DATABASE_URL: 'postgres://unused.test/database', WATERMARK_PROVIDER: 'mock', WORKER_POLL_MS: '1000', WORKER_MAX_RUN_MS: '3000' };
function runtimeFixture() {
  let job: { id: string; ownerId: string; status: string; operation: string; dispatch?: { id: string } } = { id: 'job-1', ownerId: 'owner-1', status: 'QUEUED', operation: 'video-watermark' };
  const runtime = {
    service: { get: vi.fn(async () => job) },
    runJob: vi.fn(async () => { job = { ...job, status: 'READY' }; return job; }),
    runPreflight: vi.fn().mockResolvedValue({ status: 'ready', id: 'upload-1' }),
    dispatch: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
  };
  return { runtime, factory: vi.fn(() => runtime as unknown as ProcessingRuntime), setJob: (value: Partial<typeof job>) => { job = { ...job, ...value }; } };
}

describe('standalone processing worker entry', () => {
  it('passes the durable dispatch identity to the worker lease fence', async () => {
    const s = runtimeFixture(); s.setJob({ dispatch: { id: 'dispatch-current' } });
    await runWorker({ ...environment, DISPATCH_ID: 'dispatch-current' }, { createRuntime: s.factory });
    expect(s.runtime.runJob).toHaveBeenCalledWith('job-1', expect.stringMatching(/^worker-/), 'dispatch-current');
  });
  it('finishes superseded executions without polling or submitting', async () => {
    const s = runtimeFixture(); s.setJob({ dispatch: { id: 'dispatch-current' } });
    expect(await runWorker({ ...environment, DISPATCH_ID: 'dispatch-old' }, { createRuntime: s.factory })).toMatchObject({ status: 'superseded' });
    expect(s.runtime.runJob).not.toHaveBeenCalled(); expect(s.runtime.close).toHaveBeenCalled();
  });
  it('carries the independent legacy provider configuration to the canonical runtime', () => {
    expect(workerConfigFromEnvironment({ ...environment, WATERMARK_PROVIDER: 'dewatermark', DEWATERMARK_BASE_URL: 'https://legacy.test', DEWATERMARK_PREDICT_MODE: '3.0', DEWATERMARK_TIMEOUT_MS: '12000', MOCK_PROCESSING_DELAY_MS: '25' })).toMatchObject({ providerMode: 'mock', legacyProvider: { mode: 'dewatermark', baseUrl: 'https://legacy.test', predictMode: '3.0', timeoutMs: 12000, mockDelayMs: 25 } });
  });
  it('validates environment before opening services and never embeds private values in configuration errors', async () => {
    const factory = vi.fn();
    await expect(runWorker({ ...environment, DATABASE_URL: undefined }, { createRuntime: factory })).rejects.toThrow('Missing worker configuration: DATABASE_URL');
    expect(factory).not.toHaveBeenCalled();
    expect(workerConfigFromEnvironment({ ...environment, MODE: 'preflight' })).toMatchObject({ providerMode: 'mock', r2: { bucket: 'private' } });
  });
  it('runs one owner-bound preflight and closes resources', async () => {
    const s = runtimeFixture();
    await expect(runWorker({ ...environment, MODE: 'preflight', JOB_ID: 'upload-1' }, { createRuntime: s.factory })).resolves.toMatchObject({ mode: 'preflight', status: 'ready' });
    expect(s.runtime.runPreflight).toHaveBeenCalledWith('owner-1', 'upload-1'); expect(s.runtime.close).toHaveBeenCalledTimes(1);
    expect(s.runtime.runJob).not.toHaveBeenCalled();
  });
  it('advances an existing processing task through safe poll checkpoints until ready', async () => {
    const s = runtimeFixture(); let clock = 0;
    s.runtime.runJob.mockResolvedValueOnce({ id: 'job-1', ownerId: 'owner-1', status: 'PROCESSING', operation: 'video-watermark' }).mockResolvedValueOnce({ id: 'job-1', ownerId: 'owner-1', status: 'READY', operation: 'video-watermark' });
    const sleep = vi.fn(async (milliseconds: number) => { clock += milliseconds; });
    await expect(runWorker(environment, { createRuntime: s.factory, now: () => clock, sleep })).resolves.toMatchObject({ status: 'READY' });
    expect(s.runtime.runJob).toHaveBeenCalledTimes(2); expect(sleep).toHaveBeenCalledTimes(1); expect(s.runtime.close).toHaveBeenCalled();
  });
  it('never submits an UNKNOWN record that has no durable attempt checkpoint', async () => {
    const s = runtimeFixture(); s.setJob({ status: 'UNKNOWN' });
    await expect(runWorker({ ...environment, MODE: 'reconcile' }, { createRuntime: s.factory })).resolves.toMatchObject({ status: 'UNKNOWN' });
    expect(s.runtime.runJob).not.toHaveBeenCalled();
  });
  it('leaves a bounded task in durable processing state rather than looping forever', async () => {
    const s = runtimeFixture(); let clock = 0;
    s.runtime.runJob.mockResolvedValue({ id: 'job-1', ownerId: 'owner-1', status: 'PROCESSING', operation: 'video-watermark' });
    await expect(runWorker(environment, { createRuntime: s.factory, now: () => clock, sleep: async (milliseconds: number) => { clock += milliseconds; } })).resolves.toMatchObject({ status: 'PROCESSING', continuationRequired: true });
    expect(s.runtime.runJob).toHaveBeenCalledTimes(3); expect(s.runtime.close).toHaveBeenCalled();
  });
  it('rejects mismatched ownership and releases resources without processing', async () => {
    const s = runtimeFixture(); s.setJob({ ownerId: 'other-owner' });
    await expect(runWorker(environment, { createRuntime: s.factory })).rejects.toThrow('Worker task ownership does not match');
    expect(s.runtime.runJob).not.toHaveBeenCalled(); expect(s.runtime.close).toHaveBeenCalled();
  });
  it('executes dispatcher mode only with explicit cloud routing configuration', async () => {
    const s = runtimeFixture();
    await expect(runWorker({ ...environment, MODE: 'dispatch', GOOGLE_CLOUD_PROJECT: 'demo-project', CLOUD_RUN_REGION: 'asia-east1', CLOUD_RUN_JOB: 'worker' }, { createRuntime: s.factory })).resolves.toMatchObject({ mode: 'dispatch', status: 'dispatched' });
    expect(s.runtime.dispatch).toHaveBeenCalledTimes(1); expect(s.runtime.runJob).not.toHaveBeenCalled();
  });
  it('keeps the new pipeline disabled by default and independent from the legacy provider switch', () => {
    expect(workerConfigFromEnvironment({ ...environment, WATERMARK_PROVIDER: 'dewatermark' })).toMatchObject({ enabled: false, providerMode: 'mock' });
    expect(workerConfigFromEnvironment({ ...environment, PROCESSING_ENABLED: 'true', PROCESSING_PROVIDER: 'dewatermark', DEWATERMARK_API_KEY: 'not-real-key' })).toMatchObject({ enabled: true, providerMode: 'dewatermark' });
  });
});
