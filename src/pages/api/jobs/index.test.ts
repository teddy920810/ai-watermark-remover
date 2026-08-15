import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getServices, getSession } = vi.hoisted(() => ({ getServices: vi.fn(), getSession: vi.fn() }));
vi.mock('../../../lib/services', () => ({ getServices }));
vi.mock('../../../lib/auth', () => ({ getSession }));

import { POST } from './index';

const inputKey = 'uploads/00000000-0000-4000-8000-000000000001.png';

function context(body: unknown) {
  return { request: new Request('https://example.test/api/jobs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) } as Parameters<typeof POST>[0];
}

describe('POST /api/jobs', () => {
  beforeEach(() => {
    getServices.mockReset();
    getSession.mockReset();
    getSession.mockResolvedValue({ user: { id: 'google-user-1' } });
  });

  it('returns 401 before parsing or creating a job when signed out', async () => {
    getSession.mockResolvedValue(null);
    const response = await POST(context({ inputKey }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Sign in with Google to process this upload.' });
    expect(getServices).not.toHaveBeenCalled();
  });

  it('creates a job', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'job-id', status: 'completed' });
    getServices.mockReturnValue({ jobs: { create } });
    const response = await POST(context({ inputKey }));
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ id: 'job-id', status: 'completed' });
    expect(create).toHaveBeenCalledWith(inputKey, 'google-user-1');
  });

  it('returns 400 for an invalid request', async () => {
    const response = await POST(context({ inputKey: 'arbitrary/key' }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid job request.' });
  });

  it('keeps the safe upload-not-found domain error', async () => {
    getServices.mockReturnValue({ jobs: { create: vi.fn().mockRejectedValue(new Error('Upload not found')) } });
    const response = await POST(context({ inputKey }));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Upload not found' });
  });

  it('returns 503 without leaking service configuration', async () => {
    getServices.mockReturnValue({ jobs: { create: vi.fn().mockRejectedValue(new Error('R2_ENDPOINT invalid')) } });
    const response = await POST(context({ inputKey }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('R2_ENDPOINT');
  });
});
