import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAccountServices, getServices, getSession } = vi.hoisted(() => ({ getAccountServices: vi.fn(), getServices: vi.fn(), getSession: vi.fn() }));
vi.mock('../../../lib/services', () => ({ getAccountServices, getServices }));
vi.mock('../../../lib/auth', () => ({ getSession }));

import { GET } from './benefits';

it('recovers only the authenticated account before reporting spendable credits', async () => {
  getSession.mockResolvedValue({ user: { id: 'user-1', email: 'person@example.com' } });
  const recoverUser = vi.fn().mockResolvedValue(undefined);
  const getSummary = vi.fn().mockResolvedValue({ balance: 0, paidBalance: 5 });
  getAccountServices.mockReturnValue({ recoverUser, benefits: { getSummary } });
  const response = await GET({ request: new Request('https://example.test/api/me/benefits') } as Parameters<typeof GET>[0]);
  expect(response.status).toBe(200);
  expect(recoverUser).toHaveBeenCalledWith('user-1');
  expect(recoverUser.mock.invocationCallOrder[0]).toBeLessThan(getSummary.mock.invocationCallOrder[0]);
});

const context = { request: new Request('https://example.test/api/me/benefits') } as Parameters<typeof GET>[0];

describe('GET /api/me/benefits', () => {
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

  it.each(['R2 recovery is required but not configured', 'Required recovery failed'])('returns 503 when %s without returning a balance', async (message) => {
    const getSummary = vi.fn();
    getAccountServices.mockReturnValue({ recoverUser: vi.fn().mockRejectedValue(new Error(message)), benefits: { getSummary } });
    const response = await GET(context);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(message);
    expect(getSummary).not.toHaveBeenCalled();
  });
});
