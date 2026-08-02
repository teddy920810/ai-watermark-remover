import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getServices } = vi.hoisted(() => ({ getServices: vi.fn() }));
vi.mock('../../../lib/services', () => ({ getServices }));

import { POST } from './index';

const inputKey = 'uploads/00000000-0000-4000-8000-000000000001.png';

function context(body: unknown) {
  return { request: new Request('https://example.test/api/jobs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) } as Parameters<typeof POST>[0];
}

describe('POST /api/jobs', () => {
  beforeEach(() => getServices.mockReset());

  it('creates a job', async () => {
    getServices.mockReturnValue({ jobs: { create: vi.fn().mockResolvedValue({ id: 'job-id', status: 'completed' }) } });
    const response = await POST(context({ inputKey }));
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ id: 'job-id', status: 'completed' });
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
