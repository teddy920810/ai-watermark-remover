import { describe, expect, it, vi } from 'vitest';
import { runAuthenticatedSmoke, runPublicSmoke } from '../../../scripts/production-smoke.mjs';

function response(body: unknown, status = 200, contentType = 'application/json') {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': contentType },
  });
}

function corsResponse(body: string, origin: string) {
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

  it('verifies that completed result URLs permit browser GET requests from production', async () => {
    const origin = 'https://example.test';
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ url: 'https://uploads.test/input', key: 'uploads/user/input.png' }))
      .mockResolvedValueOnce(response('', 200, 'image/png'))
      .mockResolvedValueOnce(response({ id: 'job-1', status: 'processing' }, 201))
      .mockResolvedValueOnce(response({
        status: 'completed',
        resultUrl: 'https://results.test/result.png',
        downloadUrl: 'https://results.test/download.png',
      }))
      .mockResolvedValueOnce(corsResponse('result', origin))
      .mockResolvedValueOnce(corsResponse('download', origin));

    await expect(runAuthenticatedSmoke(origin, 'session=value', fetcher)).resolves.toEqual({ status: 'passed' });
    expect(fetcher.mock.calls[4]?.[1]).toMatchObject({ headers: { Origin: origin } });
    expect(fetcher.mock.calls[5]?.[1]).toMatchObject({ headers: { Origin: origin } });
  });
});
