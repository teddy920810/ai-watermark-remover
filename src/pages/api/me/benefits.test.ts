import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getServices, getSession } = vi.hoisted(() => ({ getServices: vi.fn(), getSession: vi.fn() }));
vi.mock('../../../lib/services', () => ({ getServices }));
vi.mock('../../../lib/auth', () => ({ getSession }));

import { GET } from './benefits';

const context = { request: new Request('https://example.test/api/me/benefits') } as Parameters<typeof GET>[0];

describe('GET /api/me/benefits', () => {
  beforeEach(() => {
    getServices.mockReset();
    getSession.mockReset();
    getSession.mockResolvedValue({ user: { id: 'google-user-1' } });
  });

  it('returns 401 when signed out', async () => {
    getSession.mockResolvedValue(null);
    expect((await GET(context)).status).toBe(401);
  });

  it('returns the initialized benefit summary', async () => {
    const getSummary = vi.fn().mockResolvedValue({ balance: 1, cap: 3, dailyReward: 1, checkedInToday: false });
    getServices.mockReturnValue({ benefits: { getSummary } });
    const response = await GET(context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ balance: 1, cap: 3, dailyReward: 1, checkedInToday: false });
    expect(getSummary).toHaveBeenCalledWith('google-user-1');
  });
});
