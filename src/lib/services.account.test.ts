import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pool: vi.fn(), benefitStore: vi.fn(), requestStore: vi.fn(), objectStore: vi.fn(), jobService: vi.fn(),
  recoverable: vi.fn(), recoverUser: vi.fn(),
  getSession: vi.fn(),
  benefits: { getSummary: vi.fn(), checkIn: vi.fn() },
  objects: { marker: 'isolated-test-objects' },
}));
vi.mock('pg', () => ({ Pool: mocks.pool }));
vi.mock('./benefits/postgres-benefit-store', () => ({ PostgresBenefitStore: mocks.benefitStore }));
vi.mock('./jobs/postgres-job-request-store', () => ({ PostgresJobRequestStore: mocks.requestStore }));
vi.mock('./r2/r2-object-store', () => ({ R2ObjectStore: mocks.objectStore }));
vi.mock('./jobs/job-service', () => ({ JobService: mocks.jobService }));
vi.mock('./auth', () => ({ getSession: mocks.getSession }));

function mediaConfiguration() {
  vi.stubEnv('R2_ENDPOINT', 'https://isolated-r2.test');
  vi.stubEnv('R2_ACCESS_KEY_ID', 'isolated-test-key');
  vi.stubEnv('R2_SECRET_ACCESS_KEY', 'isolated-test-secret');
  vi.stubEnv('R2_BUCKET', 'isolated-test-bucket');
}

describe('database-only account service boundary', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    for (const key of ['R2_ENDPOINT', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'REPLICATE_API_TOKEN', 'DEWATERMARK_API_KEY', 'PAYPAL_CATALOG_JSON']) vi.stubEnv(key, undefined);
    vi.stubEnv('DATABASE_URL', 'postgresql://test:password@isolated-db.test/account-tests');
    vi.stubEnv('PAYPAL_ENABLED', 'false');
    vi.stubEnv('PAYPAL_CREDITS_ENABLED', 'true');
    vi.stubEnv('PAYPAL_ENVIRONMENT', 'sandbox');
    vi.stubEnv('WATERMARK_PROVIDER', 'mock');
    vi.stubEnv('BACKGROUND_REMOVAL_PROVIDER', 'mock');
    vi.stubEnv('OBJECT_REMOVAL_PROVIDER', 'mock');
    mocks.pool.mockImplementation(function () { return { marker: 'isolated-test-pool' }; });
    mocks.benefitStore.mockImplementation(function () { return mocks.benefits; });
    mocks.requestStore.mockImplementation(function () { return { recoverable: mocks.recoverable }; });
    mocks.objectStore.mockImplementation(function () { return mocks.objects; });
    mocks.jobService.mockImplementation(function () { return { recoverUser: mocks.recoverUser }; });
    mocks.recoverable.mockReset().mockResolvedValue([]);
    mocks.recoverUser.mockReset().mockResolvedValue(undefined);
    mocks.getSession.mockReset().mockResolvedValue({ user: { id: 'signed-in-account', email: 'person@example.test' } });
    mocks.benefits.getSummary.mockReset().mockResolvedValue({ balance: 1, cap: 3, dailyReward: 1, checkedInToday: false, paidBalance: 5 });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('creates the account store with only a database and reads the owner/environment recovery queue without R2', async () => {
    const { getAccountServices } = await import('./services');
    const account = getAccountServices();
    await account.recoverUser('signed-in-account');
    expect(account.benefits).toBe(mocks.benefits);
    expect(mocks.pool).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ connectionString: 'postgresql://test:password@isolated-db.test/account-tests' }));
    expect(mocks.benefitStore).toHaveBeenCalledWith(expect.anything(), true, 'sandbox', { 'watermark-removal': 1, 'background-removal': 1, 'object-removal': 1 }, 'sandbox-image-costs-v1');
    expect(mocks.requestStore).toHaveBeenCalledWith(expect.anything(), 'sandbox');
    expect(mocks.recoverable).toHaveBeenCalledExactlyOnceWith('signed-in-account');
    expect(mocks.objectStore).not.toHaveBeenCalled();
    expect(mocks.jobService).not.toHaveBeenCalled();
  });

  it('delegates required recovery to the media factory for the signed-in account and reuses the pool/stores', async () => {
    mediaConfiguration();
    mocks.recoverable.mockResolvedValue([{ ownerId: 'signed-in-account' }]);
    const { getAccountServices, getServices } = await import('./services');
    const account = getAccountServices();
    await account.recoverUser('signed-in-account');
    const media = getServices();
    expect(mocks.recoverUser).toHaveBeenCalledExactlyOnceWith('signed-in-account');
    expect(getAccountServices()).toBe(account);
    expect(getServices()).toBe(media);
    expect(media.benefits).toBe(account.benefits);
    expect(mocks.pool).toHaveBeenCalledOnce();
    expect(mocks.benefitStore).toHaveBeenCalledOnce();
    expect(mocks.requestStore).toHaveBeenCalledOnce();
    expect(mocks.jobService).toHaveBeenCalledWith(expect.objectContaining({ benefits: account.benefits, requests: expect.objectContaining({ recoverable: mocks.recoverable }) }));
  });

  it('fails required recovery when R2 is missing rather than returning an unrecovered balance', async () => {
    mocks.recoverable.mockResolvedValue([{ ownerId: 'signed-in-account' }]);
    const { getAccountServices } = await import('./services');
    await expect(getAccountServices().recoverUser('signed-in-account')).rejects.toThrow();
    expect(mocks.recoverUser).not.toHaveBeenCalled();
    expect(mocks.objectStore).not.toHaveBeenCalled();
  });

  it('propagates recovery failures without replacing them with a successful empty queue', async () => {
    mediaConfiguration();
    mocks.recoverable.mockResolvedValue([{ ownerId: 'signed-in-account' }]);
    mocks.recoverUser.mockRejectedValue(new Error('Recovery unavailable'));
    const { getAccountServices } = await import('./services');
    await expect(getAccountServices().recoverUser('signed-in-account')).rejects.toThrow('Recovery unavailable');
  });

  it('propagates recovery queue failures before initializing any media service', async () => {
    mocks.recoverable.mockRejectedValue(new Error('Database recovery queue unavailable'));
    const { getAccountServices } = await import('./services');
    await expect(getAccountServices().recoverUser('signed-in-account')).rejects.toThrow('Database recovery queue unavailable');
    expect(mocks.objectStore).not.toHaveBeenCalled();
  });

  it('keeps the default free-only mode independent of the new processing table', async () => {
    vi.stubEnv('PAYPAL_CREDITS_ENABLED', undefined);
    const { getAccountServices } = await import('./services');
    const account = getAccountServices();
    await account.recoverUser('legacy-account');
    expect(mocks.benefitStore).toHaveBeenCalledWith(expect.anything(), false, 'sandbox', { 'watermark-removal': 1, 'background-removal': 1, 'object-removal': 1 }, undefined);
    expect(mocks.requestStore).not.toHaveBeenCalled();
    expect(mocks.recoverable).not.toHaveBeenCalled();
    expect(mocks.objectStore).not.toHaveBeenCalled();
  });

  it('retains mandatory R2 validation for media operations', async () => {
    const { getServices } = await import('./services');
    expect(() => getServices()).toThrow();
    expect(mocks.objectStore).not.toHaveBeenCalled();
  });

  it('serves the authenticated balance through the actual account factory without R2 when no settlement is pending', async () => {
    const { GET } = await import('../pages/api/me/benefits');
    const response = await GET({ request: new Request('https://sandbox.example.test/api/me/benefits?userId=another-account&environment=live') } as Parameters<typeof GET>[0]);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ balance: 1, paidBalance: 5 });
    expect(mocks.recoverable).toHaveBeenCalledExactlyOnceWith('signed-in-account');
    expect(mocks.requestStore).toHaveBeenCalledWith(expect.anything(), 'sandbox');
    expect(mocks.benefits.getSummary).toHaveBeenCalledWith('signed-in-account', 'person@example.test');
    expect(mocks.objectStore).not.toHaveBeenCalled();
  });

  it.each(['missing R2', 'failed media recovery'])('keeps the HTTP balance unavailable for a real recovery candidate with %s', async (condition) => {
    mocks.recoverable.mockResolvedValue([{ ownerId: 'signed-in-account' }]);
    if (condition === 'failed media recovery') {
      mediaConfiguration();
      mocks.recoverUser.mockRejectedValue(new Error('Private recovery failure'));
    }
    const { GET } = await import('../pages/api/me/benefits');
    const response = await GET({ request: new Request('https://sandbox.example.test/api/me/benefits') } as Parameters<typeof GET>[0]);
    expect(response.status).toBe(503);
    expect(mocks.benefits.getSummary).not.toHaveBeenCalled();
    expect(await response.text()).not.toMatch(/R2_|Private recovery/);
  });
});
