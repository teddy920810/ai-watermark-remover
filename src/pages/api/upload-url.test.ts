import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getServices } = vi.hoisted(() => ({ getServices: vi.fn() }));
vi.mock('../../lib/services', () => ({ getServices }));

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
  beforeEach(() => getServices.mockReset());

  it('returns a signed upload contract', async () => {
    getServices.mockReturnValue({ objects: { createUploadUrl: vi.fn().mockResolvedValue('https://signed.example') } });
    const response = await POST(context({ contentType: 'image/png', size: 68 }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ url: 'https://signed.example', expiresIn: 600 });
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
