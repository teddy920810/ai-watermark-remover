import { describe, expect, it, vi } from 'vitest';
import { runAuthenticatedSmoke, runProductionSmoke, runPublicSmoke } from '../../../scripts/production-smoke.mjs';

const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAC0lEQVQImWNgQAcAABIAAW/6Y7cAAAAASUVORK5CYII=', 'base64');

function response(body: unknown, status = 200, contentType = 'application/json') {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': contentType },
  });
}

function corsResponse(body: BodyInit, origin: string) {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Access-Control-Allow-Origin': origin,
    },
  });
}

describe('production smoke', () => {
  it('keeps public checks non-destructive and confirms upload signing rejects anonymous callers', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response('<html></html>', 200, 'text/html'))
      .mockResolvedValueOnce(response('User-agent: *', 200, 'text/plain'))
      .mockResolvedValueOnce(response('<urlset></urlset>', 200, 'application/xml'))
      .mockResolvedValueOnce(response({ error: 'Sign in with Google to upload an image.' }, 401))
      .mockResolvedValueOnce(response({ error: 'Sign in with Google to view free uses.' }, 401))
      .mockResolvedValueOnce(response({ error: 'Sign in with Google to check in.' }, 401));

    await expect(runPublicSmoke('https://example.test', fetcher)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(fetcher.mock.calls.slice(0, 3).every(([, init]) => !init || init.method === undefined)).toBe(true);
    expect(fetcher.mock.calls[3]?.[1]).toMatchObject({ method: 'POST' });
    expect(fetcher.mock.calls[4]?.[1]).toBeUndefined();
    expect(fetcher.mock.calls[5]?.[1]).toMatchObject({
      method: 'POST',
      headers: { Origin: 'https://example.test' },
    });
  });

  it('does not start an authenticated upload without a session cookie', async () => {
    const fetcher = vi.fn();
    await expect(runAuthenticatedSmoke('https://example.test', '', fetcher)).resolves.toEqual({ status: 'skipped' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps the default production smoke public-only even if a cookie exists in the environment', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response('<html></html>', 200, 'text/html'))
      .mockResolvedValueOnce(response('User-agent: *', 200, 'text/plain'))
      .mockResolvedValueOnce(response('<urlset></urlset>', 200, 'application/xml'))
      .mockResolvedValueOnce(response({ error: 'unauthorized' }, 401))
      .mockResolvedValueOnce(response({ error: 'unauthorized' }, 401))
      .mockResolvedValueOnce(response({ error: 'unauthorized' }, 401));

    await expect(runProductionSmoke({
      SMOKE_BASE_URL: 'https://example.test',
      SMOKE_SESSION_COOKIE: 'session=value',
    }, fetcher)).resolves.toEqual({ status: 'public-passed' });
    expect(fetcher).toHaveBeenCalledTimes(6);
  });

  it('blocks a required functional smoke instead of silently skipping authentication', async () => {
    const fetcher = vi.fn();
    await expect(runAuthenticatedSmoke('https://example.test', '', fetcher, {
      operation: 'background-removal',
      requireAuthentication: true,
    })).rejects.toThrow('session cookie');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('runs the background-removal operation, validates transparent PNGs, and charges exactly once', async () => {
    const origin = 'https://example.test';
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ balance: 2, cap: 3, dailyReward: 1, checkedInToday: false }))
      .mockResolvedValueOnce(response({ balance: 3, cap: 3, dailyReward: 1, checkedInToday: true, granted: true, balanceFull: false }))
      .mockResolvedValueOnce(response({ url: 'https://uploads.test/input', key: 'uploads/user/input.png' }))
      .mockResolvedValueOnce(response('', 200, 'image/png'))
      .mockResolvedValueOnce(response({ id: 'job-1', status: 'processing' }, 201))
      .mockResolvedValueOnce(response({
        status: 'completed',
        resultUrl: 'https://results.test/result.png',
        downloadUrl: 'https://results.test/download.png',
      }))
      .mockResolvedValueOnce(corsResponse(transparentPng, origin))
      .mockResolvedValueOnce(corsResponse(transparentPng, origin))
      .mockResolvedValueOnce(response({ balance: 2, cap: 3, dailyReward: 1, checkedInToday: true }));

    await expect(runAuthenticatedSmoke(origin, 'session=value', fetcher, {
      operation: 'background-removal',
      fixture: transparentPng,
      requireAuthentication: true,
    })).resolves.toMatchObject({
      status: 'passed',
      operation: 'background-removal',
      balanceBefore: 3,
      balanceAfter: 2,
      result: { format: 'png', hasTransparentPixel: true },
    });
    expect(JSON.parse(String(fetcher.mock.calls[4]?.[1]?.body))).toMatchObject({ operation: 'background-removal' });
    expect(fetcher.mock.calls[6]?.[1]).toMatchObject({ headers: { Origin: origin } });
    expect(fetcher.mock.calls[7]?.[1]).toMatchObject({ headers: { Origin: origin } });
  });
});
