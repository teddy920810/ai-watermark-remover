import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getServices, getSession } = vi.hoisted(() => ({ getServices: vi.fn(), getSession: vi.fn() }));
vi.mock('../../lib/services', () => ({ getServices }));
vi.mock('../../lib/auth', () => ({ getSession }));

import { POST } from './upload-url';

function context(body: unknown) {
  return {
    request: new Request('https://example.test/api/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as Parameters<typeof POST>[0];
}

describe('POST /api/upload-url', () => {
  beforeEach(() => {
    getServices.mockReset();
    getSession.mockReset();
    getSession.mockResolvedValue({ user: { id: 'google-user-1' } });
  });

  it('requires a session before parsing metadata or creating a signed URL', async () => {
    getSession.mockResolvedValue(null);
    const response = await POST(context({ contentType: 'image/png', size: 68 }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Sign in with Google to upload an image.' });
    expect(getServices).not.toHaveBeenCalled();
  });

  it('returns a signed upload contract', async () => {
    const createUploadUrl = vi.fn().mockResolvedValue('https://signed.example');
    getServices.mockReturnValue({ objects: { createUploadUrl } });
    const response = await POST(context({ contentType: 'image/png', size: 68 }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ url: 'https://signed.example', expiresIn: 600 });
    expect(body.key).toMatch(/^uploads\/users\/[0-9a-f]{32}\/[0-9a-f-]+\.png$/);
    expect(body.key).not.toContain('google-user-1');
    expect(createUploadUrl).toHaveBeenCalledWith(body.key, 'image/png');
  });

  it('returns 400 for invalid upload metadata', async () => {
    const response = await POST(context({ contentType: 'text/plain', size: 68 }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid upload request.' });
  });

  it('returns 503 without leaking environment validation details', async () => {
    getServices.mockReturnValue({
      objects: { createUploadUrl: vi.fn().mockRejectedValue(new Error('R2_SECRET_ACCESS_KEY expected string')) },
    });
    const response = await POST(context({ contentType: 'image/png', size: 68 }));
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain('Upload service is temporarily unavailable.');
    expect(body).not.toContain('R2_SECRET_ACCESS_KEY');
  });
});
