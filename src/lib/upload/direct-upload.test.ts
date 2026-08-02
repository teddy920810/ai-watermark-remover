import { describe, expect, it, vi } from 'vitest';
import { putFileWithRetry } from './direct-upload';

describe('putFileWithRetry', () => {
  it('retries transient network failures before succeeding', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const sleep = vi.fn(async () => undefined);

    const response = await putFileWithRetry('https://upload.example/file', new Blob(['image']), 'image/png', {
      fetcher,
      sleep,
      maxAttempts: 3,
    });

    expect(response.ok).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 250);
    expect(sleep).toHaveBeenNthCalledWith(2, 500);
  });

  it('does not retry an HTTP error response', async () => {
    const response = new Response(null, { status: 403 });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
    const sleep = vi.fn(async () => undefined);

    await expect(
      putFileWithRetry('https://upload.example/file', new Blob(['image']), 'image/png', { fetcher, sleep }),
    ).resolves.toBe(response);

    expect(fetcher).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });
});
