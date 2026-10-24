import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { runAuthenticatedSmoke, runProductionSmoke, runPublicSmoke } from '../../../scripts/production-smoke.mjs';

const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAC0lEQVQImWNgQAcAABIAAW/6Y7cAAAAASUVORK5CYII=', 'base64');

function response(body: unknown, status = 200, contentType = 'application/json') {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': contentType },
  });
}

function corsResponse(body: BodyInit, origin: string, contentType = 'image/png') {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': origin,
    },
  });
}

describe('production smoke', () => {
  function watermarkFetcher(bytes: Buffer, contentType: string, withMask = false) {
    const origin = 'https://example.test';
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ balance: 2 }))
      .mockResolvedValueOnce(response({ balance: 2, checkedInToday: true }))
      .mockResolvedValueOnce(response({ url: 'https://uploads.test/input', key: 'uploads/user/input.png' }))
      .mockResolvedValueOnce(response('', 200, 'image/png'));
    if (withMask) fetcher.mockResolvedValueOnce(response({ url: 'https://uploads.test/mask', key: 'uploads/user/mask.png' })).mockResolvedValueOnce(response('', 200, 'image/png'));
    return fetcher
      .mockResolvedValueOnce(response({ id: 'job-1', status: 'processing' }, 201))
      .mockResolvedValueOnce(response({ status: 'completed', resultUrl: 'https://results.test/result', downloadUrl: 'https://results.test/download' }))
      .mockResolvedValueOnce(corsResponse(new Uint8Array(bytes), origin, contentType))
      .mockResolvedValueOnce(corsResponse(new Uint8Array(bytes), origin, contentType))
      .mockResolvedValueOnce(response({ balance: 1 }));
  }
  it.each(['jpeg', 'png'] as const)('accepts an actually decoded %s watermark result with matching response type', async (format) => {
    const fixture = await sharp({ create: { width: 512, height: 320, channels: 3, background: '#5070a0' } }).png().toBuffer();
    const bytes = await sharp(fixture).toFormat(format).toBuffer();
    const fetcher = watermarkFetcher(bytes, format === 'jpeg' ? 'image/jpeg' : 'image/png');
    await expect(runAuthenticatedSmoke('https://example.test', 'session=value', fetcher, { operation: 'watermark-removal', fixture, requireAuthentication: true })).resolves.toMatchObject({ status: 'passed', balanceBefore: 2, balanceAfter: 1, result: { format, width: 512, height: 320 } });
    expect(fetcher.mock.calls.filter(([url]) => url === 'https://example.test/api/jobs')).toHaveLength(1);
    expect(fetcher.mock.calls[3][1].body).toEqual(fixture);
  });
  it.each([['png', 'image/jpeg'], ['jpeg', 'image/png'], ['jpeg', 'application/octet-stream']] as const)('rejects %s watermark bytes declared as %s', async (format, contentType) => {
    const bytes = await sharp({ create: { width: 4, height: 2, channels: 3, background: '#5070a0' } }).toFormat(format).toBuffer();
    await expect(runAuthenticatedSmoke('https://example.test', 'session=value', watermarkFetcher(bytes, contentType), { operation: 'watermark-removal', fixture: transparentPng, requireAuthentication: true })).rejects.toThrow('Content-Type');
  });
  it('rejects a truncated JPEG even when its header still describes a valid image', async () => {
    const jpeg = await sharp({ create: { width: 512, height: 320, channels: 3, background: '#5070a0' } }).jpeg().toBuffer();
    const truncated = jpeg.subarray(0, Math.floor(jpeg.byteLength * 0.8));
    expect(await sharp(truncated).metadata()).toMatchObject({ format: 'jpeg', width: 512, height: 320 });
    await expect(runAuthenticatedSmoke('https://example.test', 'session=value', watermarkFetcher(truncated, 'image/jpeg'), { operation: 'watermark-removal', fixture: transparentPng, requireAuthentication: true })).rejects.toThrow();
  });
  it.each(['background-removal', 'object-removal'])('keeps %s output strictly PNG instead of accepting the watermark JPEG contract', async (operation) => {
    const jpeg = await sharp(transparentPng).flatten({ background: '#ffffff' }).jpeg().toBuffer();
    await expect(runAuthenticatedSmoke('https://example.test', 'session=value', watermarkFetcher(jpeg, 'image/jpeg', operation === 'object-removal'), { operation, fixture: transparentPng, maskFixture: transparentPng, requireAuthentication: true })).rejects.toThrow('PNG');
  });
  it('still rejects an opaque background-removal PNG', async () => {
    const opaque = await sharp(transparentPng).flatten({ background: '#ffffff' }).png().toBuffer();
    await expect(runAuthenticatedSmoke('https://example.test', 'session=value', watermarkFetcher(opaque, 'image/png'), { operation: 'background-removal', fixture: transparentPng, requireAuthentication: true })).rejects.toThrow('transparent pixels');
  });
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

  it('uploads both source and mask for object removal and charges exactly once', async () => {
    const origin = 'https://example.test';
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ balance: 1, cap: 3, dailyReward: 1, checkedInToday: false }))
      .mockResolvedValueOnce(response({ balance: 2, cap: 3, dailyReward: 1, checkedInToday: true, granted: true }))
      .mockResolvedValueOnce(response({ url: 'https://uploads.test/input', key: 'uploads/user/input.png' }))
      .mockResolvedValueOnce(response('', 200, 'image/png'))
      .mockResolvedValueOnce(response({ url: 'https://uploads.test/mask', key: 'uploads/user/mask.png' }))
      .mockResolvedValueOnce(response('', 200, 'image/png'))
      .mockResolvedValueOnce(response({ id: 'job-1', status: 'processing' }, 201))
      .mockResolvedValueOnce(response({ status: 'completed', resultUrl: 'https://results.test/result.png', downloadUrl: 'https://results.test/download.png' }))
      .mockResolvedValueOnce(corsResponse(transparentPng, origin))
      .mockResolvedValueOnce(corsResponse(transparentPng, origin))
      .mockResolvedValueOnce(response({ balance: 1, cap: 3, dailyReward: 1, checkedInToday: true }));

    await expect(runAuthenticatedSmoke(origin, 'session=value', fetcher, {
      operation: 'object-removal', fixture: transparentPng, maskFixture: transparentPng, requireAuthentication: true,
    })).resolves.toMatchObject({ status: 'passed', operation: 'object-removal', balanceBefore: 2, balanceAfter: 1 });
    expect(JSON.parse(String(fetcher.mock.calls[6]?.[1]?.body))).toEqual({
      inputKey: 'uploads/user/input.png', maskKey: 'uploads/user/mask.png', operation: 'object-removal',
    });
  });
});
