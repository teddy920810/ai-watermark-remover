import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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


const fixtureDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(fixtureDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

async function reviewedLegacyFixture(operation: string) {
  const directory = await mkdtemp(join(tmpdir(), 'watermark-legacy-smoke-'));
  fixtureDirectories.push(directory);
  const ledgerPath = join(directory, 'budget.json');
  const mappedOperation = operation === 'watermark-removal' ? 'image-watermark' : operation;
  const budgetId = 'credits-local-implementation-20261104';
  const scopeId = 'reviewed-legacy-smoke-fixture';
  const ownerDigest = 'a'.repeat(64);
  await writeFile(ledgerPath, JSON.stringify({
    schemaVersion: 1, budgetId, authority: 'root-reviewed-isolated-fixture', unit: 'Credits',
    issuanceLimit: 2000, grossIssued: 0, issuanceReservedUnknown: 0, grossSpendLimit: 2000, grossSpent: 0, spendReservedUnknown: 0,
    realProviderInvocationPlannedLimit: 6, realProviderInvocationsConsumed: 0, events: [],
    readyScope: {
      scopeId, reviewed: true, initialized: true, origin: 'https://example.test', environment: 'sandbox', ownerDigest,
      sessionDigest: createHash('sha256').update('session=value').digest('hex'), operations: [mappedOperation],
      walletReview: { reference: 'root-reviewed-legacy-smoke-fixture', ownerDigest, mode: 'legacy',
        charges: { [mappedOperation]: { unit: 'freeUses', amount: 1 } } },
    },
  }));
  return { ledgerPath, environment: {}, creditBudgetId: budgetId, creditScopeId: scopeId, creditEnvironment: 'sandbox',
    expectedUnit: 'freeUses', expectedAmount: 1 };
}

function expectProcessingAndArtifactPath(fetcher: ReturnType<typeof vi.fn>, downloads: 1 | 2) {
  expect(fetcher.mock.calls.filter(([url, init]) => url === 'https://example.test/api/jobs' && init?.method === 'POST')).toHaveLength(1);
  expect(fetcher.mock.calls.filter(([url]) => String(url).startsWith('https://example.test/api/jobs/'))).toHaveLength(1);
  const results = fetcher.mock.calls.filter(([url]) => String(url).startsWith('https://results.test/'));
  expect(results).toHaveLength(downloads);
  expect(String(results[0][0])).toMatch(/\/result(?:\.png)?$/);
  if (downloads === 2) expect(String(results[1][0])).toMatch(/\/download(?:\.png)?$/);
  for (const [, init] of results) expect(init).toMatchObject({ headers: { Origin: 'https://example.test' } });
  expect(fetcher.mock.calls.filter(([url, init]) => url === 'https://example.test/api/me/check-in' && new Headers(init?.headers).has('Cookie'))).toHaveLength(0);
}

async function expectAggregateCharge(ledgerPath: string, passed: boolean) {
  const ledger = JSON.parse(await readFile(ledgerPath, 'utf8'));
  expect(ledger).toMatchObject({ grossIssued: 0, issuanceReservedUnknown: 0, grossSpent: passed ? 100 : 0,
    spendReservedUnknown: passed ? 0 : 100, realProviderInvocationsConsumed: 1 });
  expect(ledger.events).toHaveLength(1);
  expect(ledger.events[0]).toMatchObject({ type: 'spend', unit: 'freeUses', amount: 1, creditAmount: 100,
    status: passed ? 'passed' : 'reserved' });
}

describe('production smoke', () => {
  function watermarkFetcher(bytes: Buffer, contentType: string, withMask = false) {
    const origin = 'https://example.test';
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ balance: 2 }))
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
    const reviewed = await reviewedLegacyFixture('watermark-removal');
    await expect(runAuthenticatedSmoke('https://example.test', 'session=value', fetcher, { ...reviewed, operation: 'watermark-removal', fixture, requireAuthentication: true })).resolves.toMatchObject({ status: 'passed', balanceBefore: 2, balanceAfter: 1, result: { format, width: 512, height: 320 } });
    expect(fetcher.mock.calls.filter(([url]) => url === 'https://example.test/api/jobs')).toHaveLength(1);
    expect(fetcher.mock.calls.find(([url, init]) => url === 'https://uploads.test/input' && init?.method === 'PUT')?.[1]?.body).toEqual(fixture);
    expectProcessingAndArtifactPath(fetcher, 2);
    await expectAggregateCharge(reviewed.ledgerPath, true);
  });
  it.each([['png', 'image/jpeg'], ['jpeg', 'image/png'], ['jpeg', 'application/octet-stream']] as const)('rejects %s watermark bytes declared as %s', async (format, contentType) => {
    const bytes = await sharp({ create: { width: 4, height: 2, channels: 3, background: '#5070a0' } }).toFormat(format).toBuffer();
    const reviewed = await reviewedLegacyFixture('watermark-removal');
    const fetcher = watermarkFetcher(bytes, contentType);
    await expect(runAuthenticatedSmoke('https://example.test', 'session=value', fetcher, { ...reviewed, operation: 'watermark-removal', fixture: transparentPng, requireAuthentication: true })).rejects.toThrow('Content-Type');
    expectProcessingAndArtifactPath(fetcher, 1);
    await expectAggregateCharge(reviewed.ledgerPath, false);
  });
  it('rejects a truncated JPEG even when its header still describes a valid image', async () => {
    const jpeg = await sharp({ create: { width: 512, height: 320, channels: 3, background: '#5070a0' } }).jpeg().toBuffer();
    const truncated = jpeg.subarray(0, Math.floor(jpeg.byteLength * 0.8));
    expect(await sharp(truncated).metadata()).toMatchObject({ format: 'jpeg', width: 512, height: 320 });
    const reviewed = await reviewedLegacyFixture('watermark-removal');
    const fetcher = watermarkFetcher(truncated, 'image/jpeg');
    const decodeError: unknown = await sharp(truncated, { failOn: 'warning' }).stats().catch(error => error);
    expect(decodeError).toBeInstanceOf(Error);
    if (!(decodeError instanceof Error)) throw new Error('Truncated fixture must fail actual JPEG decoding');
    await expect(runAuthenticatedSmoke('https://example.test', 'session=value', fetcher, { ...reviewed, operation: 'watermark-removal', fixture: transparentPng, requireAuthentication: true })).rejects.toThrow(decodeError.message.split('\n')[0]);
    expectProcessingAndArtifactPath(fetcher, 1);
    await expectAggregateCharge(reviewed.ledgerPath, false);
  });
  it.each(['background-removal', 'object-removal'])('keeps %s output strictly PNG instead of accepting the watermark JPEG contract', async (operation) => {
    const jpeg = await sharp(transparentPng).flatten({ background: '#ffffff' }).jpeg().toBuffer();
    const reviewed = await reviewedLegacyFixture(operation);
    const fetcher = watermarkFetcher(jpeg, 'image/jpeg', operation === 'object-removal');
    await expect(runAuthenticatedSmoke('https://example.test', 'session=value', fetcher, { ...reviewed, operation, fixture: transparentPng, maskFixture: transparentPng, requireAuthentication: true })).rejects.toThrow('PNG');
    expectProcessingAndArtifactPath(fetcher, 1);
    await expectAggregateCharge(reviewed.ledgerPath, false);
  });
  it('still rejects an opaque background-removal PNG', async () => {
    const opaque = await sharp(transparentPng).flatten({ background: '#ffffff' }).png().toBuffer();
    const reviewed = await reviewedLegacyFixture('background-removal');
    const fetcher = watermarkFetcher(opaque, 'image/png');
    await expect(runAuthenticatedSmoke('https://example.test', 'session=value', fetcher, { ...reviewed, operation: 'background-removal', fixture: transparentPng, requireAuthentication: true })).rejects.toThrow('transparent pixels');
    expectProcessingAndArtifactPath(fetcher, 1);
    await expectAggregateCharge(reviewed.ledgerPath, false);
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
    expect(fetcher.mock.calls.every(([, init]) => !new Headers(init?.headers).has('Cookie'))).toBe(true);
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
    expect(fetcher.mock.calls.every(([, init]) => !new Headers(init?.headers).has('Cookie'))).toBe(true);
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
      .mockResolvedValueOnce(response({ balance: 3, cap: 3, dailyReward: 1, checkedInToday: true }))
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

    const reviewed = await reviewedLegacyFixture('background-removal');
    await expect(runAuthenticatedSmoke(origin, 'session=value', fetcher, {
      ...reviewed,
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
    expect(JSON.parse(String(fetcher.mock.calls.find(([url]) => url === origin + '/api/jobs')?.[1]?.body))).toMatchObject({ operation: 'background-removal' });
    expectProcessingAndArtifactPath(fetcher, 2);
    await expectAggregateCharge(reviewed.ledgerPath, true);
  });

  it('uploads both source and mask for object removal and charges exactly once', async () => {
    const origin = 'https://example.test';
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ balance: 2, cap: 3, dailyReward: 1, checkedInToday: true }))
      .mockResolvedValueOnce(response({ url: 'https://uploads.test/input', key: 'uploads/user/input.png' }))
      .mockResolvedValueOnce(response('', 200, 'image/png'))
      .mockResolvedValueOnce(response({ url: 'https://uploads.test/mask', key: 'uploads/user/mask.png' }))
      .mockResolvedValueOnce(response('', 200, 'image/png'))
      .mockResolvedValueOnce(response({ id: 'job-1', status: 'processing' }, 201))
      .mockResolvedValueOnce(response({ status: 'completed', resultUrl: 'https://results.test/result.png', downloadUrl: 'https://results.test/download.png' }))
      .mockResolvedValueOnce(corsResponse(transparentPng, origin))
      .mockResolvedValueOnce(corsResponse(transparentPng, origin))
      .mockResolvedValueOnce(response({ balance: 1, cap: 3, dailyReward: 1, checkedInToday: true }));

    const reviewed = await reviewedLegacyFixture('object-removal');
    await expect(runAuthenticatedSmoke(origin, 'session=value', fetcher, {
      ...reviewed,
      operation: 'object-removal', fixture: transparentPng, maskFixture: transparentPng, requireAuthentication: true,
    })).resolves.toMatchObject({ status: 'passed', operation: 'object-removal', balanceBefore: 2, balanceAfter: 1 });
    expect(JSON.parse(String(fetcher.mock.calls.find(([url]) => url === origin + '/api/jobs')?.[1]?.body))).toEqual({
      inputKey: 'uploads/user/input.png', maskKey: 'uploads/user/mask.png', operation: 'object-removal',
    });
    expect(fetcher.mock.calls.find(([url, init]) => url === 'https://uploads.test/mask' && init?.method === 'PUT')?.[1]?.body).toEqual(transparentPng);
    expectProcessingAndArtifactPath(fetcher, 2);
    await expectAggregateCharge(reviewed.ledgerPath, true);
  });
});
