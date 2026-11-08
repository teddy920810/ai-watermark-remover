import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAccountServices, getServices, getSession } = vi.hoisted(() => ({ getAccountServices: vi.fn(), getServices: vi.fn(), getSession: vi.fn() }));
vi.mock('../../../lib/services', () => ({ getAccountServices, getServices }));
vi.mock('../../../lib/auth', () => ({ getSession }));

import { GET } from './benefits';

it('reads the authenticated account summary without the retired recovery dependency', async () => {
  getSession.mockResolvedValue({ user: { id: 'user-1', email: 'person@example.com' } });
  const getSummary = vi.fn().mockResolvedValue({ balance: 0, paidBalance: 5 });
  getAccountServices.mockReturnValue({ benefits: { getSummary } });
  const response = await GET({ request: new Request('https://example.test/api/me/benefits') } as Parameters<typeof GET>[0]);
  expect(response.status).toBe(200);
  expect(getSummary).toHaveBeenCalledExactlyOnceWith('user-1', 'person@example.com');
});

const context = { request: new Request('https://example.test/api/me/benefits') } as Parameters<typeof GET>[0];

describe('GET /api/me/benefits', () => {
  it('asks an old client to refresh instead of presenting Credits as free-use counts', async () => {
    getSession.mockResolvedValue({ user: { id: 'user-1' } });
    getAccountServices.mockReturnValue({ recoverUser: vi.fn(), benefits: { getSummary: vi.fn(async () => ({ walletMode: 'unified', unit: 'credits', credits: 100 })) } });
    expect((await GET(context)).status).toBe(409);
    const current = { request: new Request('https://example.test/api/me/benefits', { headers: { 'X-Credits-Contract': 'credits-v1' } }) } as Parameters<typeof GET>[0];
    expect((await GET(current)).status).toBe(200);
  });
  beforeEach(() => {
    getServices.mockReset();
    getAccountServices.mockReset();
    getSession.mockReset();
    getSession.mockResolvedValue({ user: { id: 'google-user-1', email: 'Person@Example.com' } });
  });

  it('returns 401 when signed out', async () => {
    getSession.mockResolvedValue(null);
    expect((await GET(context)).status).toBe(401);
    expect(getAccountServices).not.toHaveBeenCalled();
    expect(getServices).not.toHaveBeenCalled();
  });

  it('returns the initialized benefit summary', async () => {
    const getSummary = vi.fn().mockResolvedValue({ balance: 1, cap: 3, dailyReward: 1, checkedInToday: false });
    getAccountServices.mockReturnValue({ recoverUser: vi.fn().mockResolvedValue(undefined), benefits: { getSummary } });
    const response = await GET(context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ balance: 1, cap: 3, dailyReward: 1, checkedInToday: false });
    expect(getSummary).toHaveBeenCalledWith('google-user-1', 'Person@Example.com');
    expect(getServices).not.toHaveBeenCalled();
  });

  it('returns a sanitized 503 when the account database is unavailable', async () => {
    const getSummary = vi.fn().mockRejectedValue(new Error('Private database failure'));
    getAccountServices.mockReturnValue({ benefits: { getSummary } });
    const response = await GET(context);
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('Private database');
  });
});
