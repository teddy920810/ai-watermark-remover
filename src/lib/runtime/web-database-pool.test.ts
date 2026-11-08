import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { S3Client } from '@aws-sdk/client-s3';

const mocks = vi.hoisted(() => ({ pool: vi.fn() }));
vi.mock('pg', () => ({ Pool: mocks.pool }));
const config = {
  r2: { endpoint: 'https://unused.test', accessKeyId: 'fixture', secretAccessKey: 'fixture', bucket: 'fixture' },
  databaseUrl: 'postgres://unused.test/shared', providerMode: 'mock' as const, enabled: false,
};
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  mocks.pool.mockImplementation(function () { return { end: vi.fn().mockResolvedValue(undefined) }; });
  vi.stubEnv('DATABASE_URL', config.databaseUrl);
  vi.stubEnv('PAYPAL_ENABLED', 'false'); vi.stubEnv('PAYPAL_CREDITS_ENABLED', 'false');
  vi.stubEnv('PAYPAL_CATALOG_JSON', undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('Web and Worker database ownership', () => {
  it('shares the bounded Web pool with the account store and never closes that borrowed pool', async () => {
    const { createProcessingRuntime } = await import('./processing-services');
    const { getAccountServices } = await import('../services');
    const runtime = createProcessingRuntime({ ...config, scope: 'web' });
    const account = getAccountServices();
    expect(mocks.pool).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ connectionString: config.databaseUrl, max: 3 }));
    expect(account.pool).toBe(mocks.pool.mock.results[0].value);
    await runtime.close();
    expect(account.pool.end).not.toHaveBeenCalled();
  });
  it('refuses to reuse the shared Web pool for a different database', async () => {
    const { createProcessingRuntime } = await import('./processing-services');
    const runtime = createProcessingRuntime({ ...config, scope: 'web' });
    try {
      expect(() => createProcessingRuntime({ ...config, scope: 'web', databaseUrl: 'postgres://another.test/private' })).toThrow('Web database configuration changed');
      expect(mocks.pool).toHaveBeenCalledOnce();
    } finally { await runtime.close(); }
  });
  it('closes Worker-owned pool and client once, and leaves injected resources open', async () => {
    const { createProcessingRuntime } = await import('./processing-services');
    const destroy = vi.spyOn(S3Client.prototype, 'destroy');
    const runtime = createProcessingRuntime({ ...config, scope: 'worker' });
    const owned = mocks.pool.mock.results[0].value;
    await runtime.close(); await runtime.close();
    expect(owned.end).toHaveBeenCalledOnce(); expect(destroy).toHaveBeenCalledOnce();
    const end = vi.fn(); const borrowedDestroy = vi.fn();
    const borrowed = createProcessingRuntime({ ...config, dependencies: { pool: { end } as unknown as Pool, client: { destroy: borrowedDestroy } as unknown as S3Client } });
    await borrowed.close();
    expect(end).not.toHaveBeenCalled(); expect(borrowedDestroy).not.toHaveBeenCalled();
  });
  it('still destroys the owned client when pool shutdown fails and preserves the same failure', async () => {
    const { createProcessingRuntime } = await import('./processing-services');
    const destroy = vi.spyOn(S3Client.prototype, 'destroy');
    const runtime = createProcessingRuntime(config);
    const owned = mocks.pool.mock.results[0].value;
    const failure = new Error('Shutdown failed'); owned.end.mockRejectedValue(failure);
    await expect(runtime.close()).rejects.toBe(failure);
    await expect(runtime.close()).rejects.toBe(failure);
    expect(owned.end).toHaveBeenCalledOnce(); expect(destroy).toHaveBeenCalledOnce();
  });
});
