import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getServices, getSession } = vi.hoisted(() => ({ getServices: vi.fn(), getSession: vi.fn() }));
vi.mock('../../../lib/services', () => ({ getServices }));
vi.mock('../../../lib/auth', () => ({ getSession }));

import { GET } from './[id]';

const id = '00000000-0000-4000-8000-000000000002';
const context = (value: string | undefined) => ({
  params: { id: value },
  request: new Request(`https://example.test/api/jobs/${value ?? ''}`),
}) as unknown as Parameters<typeof GET>[0];

describe('GET /api/jobs/:id', () => {
  beforeEach(() => {
    getServices.mockReset();
    getSession.mockReset();
    getSession.mockResolvedValue({ user: { id: 'google-user-1' } });
  });

  it('returns 401 for signed-out callers', async () => {
    getSession.mockResolvedValue(null);
    const response = await GET(context(id));
    expect(response.status).toBe(401);
    expect(getServices).not.toHaveBeenCalled();
  });

  it('rejects malformed IDs before loading services', async () => {
    const response = await GET(context('bad-id'));
    expect(response.status).toBe(400);
    expect(getServices).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown job', async () => {
    getServices.mockReturnValue({ jobs: { get: vi.fn().mockResolvedValue(null) } });
    const response = await GET(context(id));
    expect(response.status).toBe(404);
  });

  it('does not reveal a job owned by another user', async () => {
    getServices.mockReturnValue({
      jobs: { get: vi.fn().mockResolvedValue({ ownerId: 'google-user-2', status: 'completed', resultKey: 'results/job.png' }) },
    });
    const response = await GET(context(id));
    expect(response.status).toBe(404);
  });

  it('returns signed result links for a completed job', async () => {
    getServices.mockReturnValue({
      jobs: { get: vi.fn().mockResolvedValue({ ownerId: 'google-user-1', status: 'completed', resultKey: 'results/job.png' }) },
      objects: {
        createResultUrl: vi.fn().mockResolvedValue('https://result.example'),
        createDownloadUrl: vi.fn().mockResolvedValue('https://download.example'),
      },
    });
    const response = await GET(context(id));
    await expect(response.json()).resolves.toEqual({
      status: 'completed', resultUrl: 'https://result.example', downloadUrl: 'https://download.example',
    });
  });

  it('returns 503 without leaking service configuration', async () => {
    getServices.mockReturnValue({ jobs: { get: vi.fn().mockRejectedValue(new Error('R2_ACCESS_KEY_ID missing')) } });
    const response = await GET(context(id));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('R2_ACCESS_KEY_ID');
  });
});
