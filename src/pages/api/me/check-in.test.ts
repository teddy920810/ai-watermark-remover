import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAccountServices, getServices, getSession } = vi.hoisted(() => ({ getAccountServices: vi.fn(), getServices: vi.fn(), getSession: vi.fn() }));
vi.mock('../../../lib/services', () => ({ getAccountServices, getServices }));
vi.mock('../../../lib/auth', () => ({ getSession }));

import { POST } from './check-in';

const context = { request: new Request('https://example.test/api/me/check-in', { method: 'POST' }) } as Parameters<typeof POST>[0];

describe('POST /api/me/check-in', () => {
  beforeEach(() => {
    getServices.mockReset();
    getAccountServices.mockReset();
    getSession.mockReset();
    getSession.mockResolvedValue({ user: { id: 'google-user-1', email: 'Person@Example.com' } });
  });

  it('returns 401 when signed out', async () => {
    getSession.mockResolvedValue(null);
    expect((await POST(context)).status).toBe(401);
  });

  it('returns the atomic daily check-in result', async () => {
    const checkIn = vi.fn().mockResolvedValue({ balance: 2, cap: 3, dailyReward: 1, checkedInToday: true, granted: true, balanceFull: false });
    const recoverUser = vi.fn();
    getAccountServices.mockReturnValue({ recoverUser, benefits: { checkIn } });
    const response = await POST(context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ balance: 2, checkedInToday: true, granted: true });
    expect(checkIn).toHaveBeenCalledWith('google-user-1', 'Person@Example.com');
    expect(getServices).not.toHaveBeenCalled();
    expect(recoverUser).not.toHaveBeenCalled();
  });
});
