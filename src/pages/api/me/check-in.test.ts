import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getServices, getSession } = vi.hoisted(() => ({ getServices: vi.fn(), getSession: vi.fn() }));
vi.mock('../../../lib/services', () => ({ getServices }));
vi.mock('../../../lib/auth', () => ({ getSession }));

import { POST } from './check-in';

const context = { request: new Request('https://example.test/api/me/check-in', { method: 'POST' }) } as Parameters<typeof POST>[0];

describe('POST /api/me/check-in', () => {
  beforeEach(() => {
    getServices.mockReset();
    getSession.mockReset();
    getSession.mockResolvedValue({ user: { id: 'google-user-1' } });
  });

  it('returns 401 when signed out', async () => {
    getSession.mockResolvedValue(null);
    expect((await POST(context)).status).toBe(401);
  });

  it('returns the atomic daily check-in result', async () => {
    const checkIn = vi.fn().mockResolvedValue({ balance: 2, cap: 3, dailyReward: 1, checkedInToday: true, granted: true, balanceFull: false });
    getServices.mockReturnValue({ benefits: { checkIn } });
    const response = await POST(context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ balance: 2, checkedInToday: true, granted: true });
    expect(checkIn).toHaveBeenCalledWith('google-user-1');
  });
});
