import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ pool: vi.fn(), benefits: vi.fn(), summary: vi.fn(), getSession: vi.fn() }));
vi.mock('pg', () => ({ Pool: mocks.pool }));
vi.mock('./benefits/postgres-benefit-store', () => ({ PostgresBenefitStore: mocks.benefits }));
vi.mock('./auth', () => ({ getSession: mocks.getSession }));
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  for (const key of ['R2_ENDPOINT', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'REPLICATE_API_TOKEN', 'DEWATERMARK_API_KEY', 'PAYPAL_CATALOG_JSON']) vi.stubEnv(key, undefined);
  vi.stubEnv('DATABASE_URL', 'postgresql://fixture.test/account');
  vi.stubEnv('PAYPAL_ENABLED', 'false'); vi.stubEnv('PAYPAL_CREDITS_ENABLED', 'true'); vi.stubEnv('PAYPAL_ENVIRONMENT', 'sandbox');
  mocks.pool.mockImplementation(function () { return {}; });
  mocks.benefits.mockImplementation(function () { return { getSummary: mocks.summary }; });
  mocks.getSession.mockResolvedValue({ user: { id: 'owner', email: 'owner@example.test' } });
  mocks.summary.mockResolvedValue({ balance: 1, paidBalance: 5 });
});
afterEach(() => vi.unstubAllEnvs());
describe('account services without the retired JobService dependency', () => {
  it('opens only one bounded database pool without requiring media credentials', async () => {
    const { getAccountServices } = await import('./services');
    const first = getAccountServices();
    expect(getAccountServices()).toBe(first);
    expect(mocks.pool).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ connectionString: 'postgresql://fixture.test/account', max: 3 }));
    expect(mocks.benefits).toHaveBeenCalledOnce();
    expect(mocks.benefits.mock.calls[0].slice(1, 3)).toEqual([true, 'sandbox']);
  });
  it('returns only the authenticated account balance without legacy recovery or query-selected identity', async () => {
    const { GET } = await import('../pages/api/me/benefits');
    const response = await GET({ request: new Request('https://example.test/api/me/benefits?userId=other&environment=live') } as Parameters<typeof GET>[0]);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ balance: 1, paidBalance: 5 });
    expect(mocks.summary).toHaveBeenCalledExactlyOnceWith('owner', 'owner@example.test');
  });
  it('does not open account services for an anonymous caller', async () => {
    mocks.getSession.mockResolvedValue(null);
    const { GET } = await import('../pages/api/me/benefits');
    expect((await GET({ request: new Request('https://example.test/api/me/benefits') } as Parameters<typeof GET>[0])).status).toBe(401);
    expect(mocks.pool).not.toHaveBeenCalled();
  });
  it('fails closed and redacts database errors', async () => {
    mocks.summary.mockRejectedValue(new Error('private database failure'));
    const { GET } = await import('../pages/api/me/benefits');
    const response = await GET({ request: new Request('https://example.test/api/me/benefits') } as Parameters<typeof GET>[0]);
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('private database');
  });
});
