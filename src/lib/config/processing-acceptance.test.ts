import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AcceptanceBudget, CreditsAcceptanceBudget } from '../../../scripts/lib/acceptance-budget.mjs';
import { createHash } from 'node:crypto';
import { acceptanceCliOptions, runProcessingAcceptance } from '../../../scripts/processing-acceptance.mjs';
import { runAuthenticatedSmoke, runProductionSmoke } from '../../../scripts/production-smoke.mjs';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'watermark-site-acceptance-'));
  directories.push(directory);
  const sample = await sharp({ create: { width: 4, height: 2, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
  const samplePath = join(directory, 'sample.jpg'); await writeFile(samplePath, sample);
  return { directory, sample, samplePath, ledgerPath: join(directory, 'budget.json'), reportDir: join(directory, 'reports') };
}
function site(sample: Uint8Array, options: { status?: string; lostSubmit?: boolean; balanceAfter?: number; invalidDownload?: boolean; video?: boolean; parent?: boolean; incorrectCharge?: boolean; png?: boolean; purchased?: boolean; unrelatedDebit?: boolean; downloadSample?: Uint8Array; creditsAmount?: number } = {}) {
  let submitted = false;
  let uploadNumber = 0;
  const metadata = { kind: options.video ? 'video' : 'image', contentType: options.video ? 'video/mp4' : options.png ? 'image/png' : 'image/jpeg', width: 4, height: 2, byteSize: sample.byteLength, ...(options.video ? { durationSeconds: 2, fps: 24, hasAudio: true } : {}) };
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const address = new URL(String(url));
    const route = address.pathname;
    if (address.hostname.endsWith('r2.cloudflarestorage.com')) {
      if (init?.method === 'PUT') return new Response(null, { status: 200 });
      return new Response(options.invalidDownload ? new Uint8Array([1, 2, 3]) : new Uint8Array(options.downloadSample ?? sample), { headers: { 'Content-Type': metadata.contentType } });
    }
    if (['/', '/robots.txt', '/sitemap.xml'].includes(route)) return new Response('public');
    if (route === '/api/v1/capabilities') return Response.json({ operations: [] });
    if (route === '/api/v1/me' && options.creditsAmount) return Response.json({ walletMode: 'unified', unit: 'credits', credits: submitted ? 1000 - options.creditsAmount : 1000, admissionEnabled: true });
    if (route === '/api/v1/me') return Response.json({ freeUses: submitted && !options.video && !options.parent && !options.purchased ? options.balanceAfter ?? 2 : 3, processingCredits: submitted && (options.video || options.parent || options.unrelatedDebit) ? options.balanceAfter ?? 99 : 100, ...(options.purchased ? { purchasedImageCredits: submitted ? 90 : 100 } : {}) });
    if (route === '/api/v1/uploads' && init?.method === 'POST') return Response.json({ id: `upload-${++uploadNumber}`, status: 'created', uploadUrl: 'https://account.r2.cloudflarestorage.com/private/input?X-Amz-Signature=private-upload' });
    if (/^\/api\/v1\/uploads\/upload-\d\/complete$/.test(route)) return Response.json({ status: 'validating' }, { status: 202 });
    if (/^\/api\/v1\/uploads\/upload-\d$/.test(route)) return Response.json({ id: 'upload-1', status: 'ready', artifact: { id: 'artifact-1', metadata } });
    if (route === '/api/v1/quotes') return Response.json({ id: 'quote-1', amount: options.creditsAmount ?? (options.purchased ? 10 : 1), unit: options.creditsAmount ? 'credits' : options.purchased ? 'purchasedImageCredits' : options.video || options.parent ? 'processingCredits' : 'freeUses', isDemo: false, expectedOutput: metadata });
    if (route === '/api/v1/jobs' && init?.method === 'POST') { submitted = true; if (options.lostSubmit) throw new Error('private session=value; private signed URL'); return Response.json({ id: 'job-1', status: 'QUEUED' }, { status: 201 }); }
    if (route === '/api/v1/jobs/parent-1') return Response.json({ id: 'parent-1', status: 'READY', isDemo: false, result: { id: 'parent-result', canRefine: true, metadata } });
    if (route === '/api/v1/jobs/job-1') return Response.json({ id: 'job-1', status: options.status ?? 'READY', charge: { status: 'settled', amount: options.creditsAmount ?? (options.incorrectCharge ? 2 : options.purchased ? 10 : 1), unit: options.creditsAmount ? 'credits' : options.purchased ? 'purchasedImageCredits' : options.video || options.parent ? 'processingCredits' : 'freeUses' }, isDemo: false, result: { id: 'result-1', metadata } });
    if (route === '/api/v1/jobs/job-1/download') return Response.json({ url: 'https://account.r2.cloudflarestorage.com/private/result?X-Amz-Signature=private-download' });
    throw new Error(`Unexpected test route ${route}`);
  });
  return fetcher;
}
const environment = { PROCESSING_ACCEPTANCE_SESSION_COOKIE: 'session=private' };
const base = { baseUrl: 'https://example.test', operation: 'image-watermark', functional: true, expectedAmount: 1, expectedUnit: 'freeUses', pollIntervalMs: 1, maxWaitMs: 10 };
const ready = { scopeId: 'reviewed-six', reviewed: true, initialized: true, origin: base.baseUrl, environment: 'sandbox' as const,
  ownerDigest: 'a'.repeat(64), sessionDigest: createHash('sha256').update(environment.PROCESSING_ACCEPTANCE_SESSION_COOKIE).digest('hex'),
  operations: ['image-watermark', 'image-watermark-pro', 'image-refine', 'video-watermark', 'background-removal', 'object-removal'],
  walletReview: { reference: 'root-reviewed-unified-fixture', ownerDigest: 'a'.repeat(64), mode: 'unified', charges: {
    'image-watermark': { unit: 'credits', amount: 100 }, 'image-watermark-pro': { unit: 'credits', amount: 300 },
    'image-refine': { unit: 'credits', amount: 100 }, 'video-watermark': { unit: 'credits', amount: 100 },
    'background-removal': { unit: 'credits', amount: 10 }, 'object-removal': { unit: 'credits', amount: 10 },
  } } };
const proofOptions = { creditBudgetId: 'credits-local-implementation-20261104', creditScopeId: ready.scopeId, creditEnvironment: 'sandbox' };
async function creditBudget(file: string, overrides = {}) {
  await writeFile(file, JSON.stringify({ schemaVersion: 1, budgetId: 'credits-local-implementation-20261104', authority: 'user-authorization', unit: 'Credits',
    issuanceLimit: 2000, grossIssued: 0, issuanceReservedUnknown: 0, grossSpendLimit: 2000, grossSpent: 0, spendReservedUnknown: 0,
    realProviderInvocationPlannedLimit: 6, realProviderInvocationsConsumed: 0, events: [], readyScope: ready, ...overrides }));
  return new CreditsAcceptanceBudget(file, { budgetId: 'credits-local-implementation-20261104', scopeId: ready.scopeId, origin: ready.origin,
    environment: ready.environment, session: environment.PROCESSING_ACCEPTANCE_SESSION_COOKIE, operation: 'image-watermark' });
}
async function legacyFixture(charges: Record<string, { unit: string; amount: number }> = {}) {
  const state = await fixture();
  await creditBudget(state.ledgerPath, { readyScope: { ...ready, walletReview: {
    reference: 'root-verified-legacy-fixture', ownerDigest: ready.ownerDigest, mode: 'legacy', charges: {
      'image-watermark': { unit: 'freeUses', amount: 1 }, 'image-watermark-pro': { unit: 'processingCredits', amount: 3 },
      'image-refine': { unit: 'processingCredits', amount: 1 }, 'video-watermark': { unit: 'processingCredits', amount: 1 },
      'background-removal': { unit: 'freeUses', amount: 1 }, 'object-removal': { unit: 'freeUses', amount: 1 }, ...charges,
    },
  } } });
  return { ...state, ...proofOptions };
}

describe('common functional entry proof before first fetch or legacy ledger creation', () => {
  function bootstrapFetcher() {
    let issued = 0;
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (new Headers(init?.headers).has('Cookie') && ['/api/v1/me', '/api/me/benefits'].includes(new URL(String(url)).pathname)) issued += 100;
      throw new Error('Injected stop after recording the first account-read effect');
    });
    return { fetcher, issued: () => issued };
  }
  it('has an injected first account GET that demonstrably records the initial 100 issuance', async () => {
    const f = bootstrapFetcher();
    await f.fetcher(`${base.baseUrl}/api/v1/me`, { headers: { Cookie: environment.PROCESSING_ACCEPTANCE_SESSION_COOKIE } }).catch(() => undefined);
    expect({ calls: f.fetcher.mock.calls.length, issued: f.issued() }).toEqual({ calls: 1, issued: 100 });
  });
  for (const scenario of ['unknown-legacy-unit', 'uninitialized-purchased-unit', 'reviewed-unified-processing-unit', 'omitted-unit', 'wrong-session-legacy-unit', 'missing-wallet-review', 'missing-review-reference', 'wrong-wallet-owner', 'wrong-origin', 'wrong-environment', 'wrong-reviewed-amount'] as const) {
    it.each(['v1', 'direct-smoke', 'required-wrapper'] as const)(`${scenario}: %s refuses before every fetch and any old ledger creation`, async entry => {
      const state = await fixture();
      if (!['unknown-legacy-unit', 'omitted-unit'].includes(scenario)) await creditBudget(state.ledgerPath, {
        readyScope: { ...ready, initialized: scenario !== 'uninitialized-purchased-unit',
          sessionDigest: scenario === 'wrong-session-legacy-unit' ? 'b'.repeat(64) : ready.sessionDigest,
          walletReview: { reference: 'root-reviewed-fixture-unified', ownerDigest: ready.ownerDigest, mode: 'unified',
            charges: { 'image-watermark': { unit: 'credits', amount: 100 } } } },
      });
      if (['missing-wallet-review', 'missing-review-reference', 'wrong-wallet-owner', 'wrong-origin', 'wrong-environment', 'wrong-reviewed-amount'].includes(scenario)) {
        const ledger = JSON.parse(await readFile(state.ledgerPath, 'utf8'));
        if (scenario === 'missing-wallet-review') delete ledger.readyScope.walletReview;
        if (scenario === 'missing-review-reference') delete ledger.readyScope.walletReview.reference;
        if (scenario === 'wrong-wallet-owner') ledger.readyScope.walletReview.ownerDigest = 'c'.repeat(64);
        if (scenario === 'wrong-origin') ledger.readyScope.origin = 'https://other.test';
        if (scenario === 'wrong-environment') ledger.readyScope.environment = 'live';
        if (scenario === 'wrong-reviewed-amount') ledger.readyScope.walletReview.charges['image-watermark'].amount = 300;
        await writeFile(state.ledgerPath, JSON.stringify(ledger));
      }
      const before = await readFile(state.ledgerPath, 'utf8').catch(() => null);
      const f = bootstrapFetcher();
      const proofOnly = ['missing-wallet-review', 'missing-review-reference', 'wrong-wallet-owner', 'wrong-origin', 'wrong-environment', 'wrong-reviewed-amount'].includes(scenario);
      const expectedUnit = proofOnly ? 'credits' : scenario === 'omitted-unit' ? undefined : scenario === 'uninitialized-purchased-unit' ? 'purchasedImageCredits' : scenario === 'reviewed-unified-processing-unit' ? 'processingCredits' : 'freeUses';
      const options = { ...base, ...state, expectedUnit, expectedAmount: proofOnly ? 100 : 1, creditBudgetId: 'credits-local-implementation-20261104', creditScopeId: ready.scopeId, creditEnvironment: 'sandbox', requireAuthentication: true };
      const result = entry === 'v1' ? runProcessingAcceptance(options, { environment, fetcher: f.fetcher })
        : entry === 'direct-smoke' ? runAuthenticatedSmoke(base.baseUrl, environment.PROCESSING_ACCEPTANCE_SESSION_COOKIE, f.fetcher, { ...options, environment })
          : runProductionSmoke({ ...environment, SMOKE_BASE_URL: base.baseUrl, SMOKE_SESSION_COOKIE: environment.PROCESSING_ACCEPTANCE_SESSION_COOKIE }, f.fetcher, options);
      await expect(result).rejects.toThrow();
      expect({ calls: f.fetcher.mock.calls.length, issued: f.issued(), ledger: await readFile(state.ledgerPath, 'utf8').catch(() => null) }).toEqual({ calls: 0, issued: 0, ledger: before });
    });
  }
});


describe('reviewed legacy fixtures share the aggregate without implicit issuance', () => {
  it.each(['direct-smoke', 'required-wrapper'] as const)('%s preserves the original one-use contract without authenticated check-in', async entry => {
    const state = await legacyFixture();
    let submitted = false;
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const address = new URL(String(url));
      const authenticated = new Headers(init?.headers).has('Cookie');
      if (address.hostname.endsWith('r2.cloudflarestorage.com')) {
        expect(authenticated).toBe(false);
        return init?.method === 'PUT' ? new Response(null) : new Response(new Uint8Array(state.sample), { headers: { 'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': base.baseUrl } });
      }
      if (['/', '/robots.txt', '/sitemap.xml'].includes(address.pathname)) return new Response('public');
      if (!authenticated) return new Response(null, { status: 401 });
      if (address.pathname === '/api/me/check-in') throw new Error('An authenticated check-in must never be implicit');
      if (address.pathname === '/api/me/benefits') {
        expect(JSON.parse(await readFile(state.ledgerPath, 'utf8'))).toMatchObject({ spendReservedUnknown: 100, realProviderInvocationsConsumed: 1 });
        return Response.json({ balance: submitted ? 2 : 3 });
      }
      if (address.pathname === '/api/upload-url') return Response.json({ key: 'fixture-input', url: 'https://account.r2.cloudflarestorage.com/private/input' });
      if (address.pathname === '/api/jobs' && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toMatchObject({ operation: 'watermark-removal' });
        submitted = true; return Response.json({ id: 'fixture-job' });
      }
      if (address.pathname === '/api/jobs/fixture-job') return Response.json({ status: 'completed', resultUrl: 'https://account.r2.cloudflarestorage.com/private/result', downloadUrl: 'https://account.r2.cloudflarestorage.com/private/download' });
      throw new Error('Unexpected fixture request');
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const options = { ...base, ...state, fixture: state.sample, requireAuthentication: true, environment };
      const result = entry === 'direct-smoke'
        ? await runAuthenticatedSmoke(base.baseUrl, environment.PROCESSING_ACCEPTANCE_SESSION_COOKIE, fetcher, options)
        : await runProductionSmoke({ ...environment, SMOKE_BASE_URL: base.baseUrl }, fetcher, options);
      expect(result).toMatchObject({ status: 'passed', operation: 'watermark-removal', balanceBefore: 3, balanceAfter: 2 });
      expect(fetcher.mock.calls.filter(([url, init]) => new URL(String(url)).pathname === '/api/jobs' && init?.method === 'POST')).toHaveLength(1);
      expect(fetcher.mock.calls.filter(([url, init]) => new URL(String(url)).pathname === '/api/me/check-in' && new Headers(init?.headers).has('Cookie'))).toHaveLength(0);
      expect(JSON.parse(await readFile(state.ledgerPath, 'utf8'))).toMatchObject({ grossIssued: 0, grossSpent: 100, spendReservedUnknown: 0, realProviderInvocationsConsumed: 1,
        events: [{ unit: 'freeUses', amount: 1, creditAmount: 100, status: 'passed' }] });
    } finally { log.mockRestore(); }
  });

  it.each([
    { unit: 'freeUses' as const, amount: 1, factor: 100, operation: 'image-watermark' },
    { unit: 'processingCredits' as const, amount: 1, factor: 100, operation: 'image-watermark' },
    { unit: 'purchasedImageCredits' as const, amount: 10, factor: 1, operation: 'background-removal' },
  ])('accounts $unit in the same gross issuance, spend and Provider limits while preserving original amounts', async ({ unit, amount, factor, operation }) => {
    const state = await legacyFixture({ [operation]: { unit, amount } });
    const budget = new CreditsAcceptanceBudget(state.ledgerPath, { budgetId: proofOptions.creditBudgetId, scopeId: ready.scopeId, origin: ready.origin,
      environment: ready.environment, session: environment.PROCESSING_ACCEPTANCE_SESSION_COOKIE, operation });
    await budget.authorize(unit, amount);
    const issuanceAmount = 2000 / factor;
    const issuance = await budget.reserveIssuance({ source: 'reviewed-legacy-fixture', amount: issuanceAmount, unit });
    await budget.finishIssuance(issuance, { amount: issuanceAmount });
    await budget.finishIssuance(issuance, { amount: issuanceAmount });
    await expect(budget.reserveIssuance({ source: 'excess-legacy-fixture', amount: 1, unit })).rejects.toThrow(/budget/i);
    const first = await budget.reserve('image', 'reviewed original unit', { amount, unit, operation });
    await budget.finish(first, { status: 'passed', creditsBefore: amount + 5, creditsAfter: 5 });
    const uncertain = await budget.reserve('image', 'uncertain original unit', { amount, unit, operation });
    await budget.finish(uncertain, { status: 'unknown' });
    const ledger = await budget.summary();
    expect(ledger).toMatchObject({ grossIssued: 2000, issuanceReservedUnknown: 0, grossSpent: amount * factor, spendReservedUnknown: amount * factor, realProviderInvocationsConsumed: 2 });
    expect(ledger.events.filter(event => event.type === 'spend')).toEqual([
      expect.objectContaining({ unit, amount, creditAmount: amount * factor, status: 'passed' }),
      expect.objectContaining({ unit, amount, creditAmount: amount * factor, status: 'unknown' }),
    ]);
  });

  it('never resets cumulative totals or six slots when a reviewed legacy scope changes to unified', async () => {
    const state = await legacyFixture();
    const original = JSON.parse(await readFile(state.ledgerPath, 'utf8'));
    await writeFile(state.ledgerPath, JSON.stringify({ ...original, grossIssued: 2000, grossSpent: 1900, realProviderInvocationsConsumed: 5 }));
    const budget = new CreditsAcceptanceBudget(state.ledgerPath, { budgetId: proofOptions.creditBudgetId, scopeId: ready.scopeId, origin: ready.origin,
      environment: ready.environment, session: environment.PROCESSING_ACCEPTANCE_SESSION_COOKIE, operation: 'image-watermark' });
    await budget.authorize('freeUses', 1);
    const reservation = await budget.reserve('image', 'last approved legacy slot', { amount: 1, unit: 'freeUses', operation: 'image-watermark' });
    await budget.finish(reservation, { status: 'unknown' });
    const held = JSON.parse(await readFile(state.ledgerPath, 'utf8'));
    await writeFile(state.ledgerPath, JSON.stringify({ ...held, readyScope: ready }));
    const before = await readFile(state.ledgerPath, 'utf8');
    const fetcher = vi.fn();
    await expect(runProcessingAcceptance({ ...base, ...state, expectedUnit: 'credits', expectedAmount: 100 }, { environment, fetcher })).rejects.toMatchObject({ code: 'budget_authorization' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await readFile(state.ledgerPath, 'utf8')).toBe(before);
    expect(await budget.summary()).toMatchObject({ grossIssued: 2000, grossSpent: 1900, spendReservedUnknown: 100, realProviderInvocationsConsumed: 6 });
  });
});

describe('aggregate new Credits acceptance authorization', () => {
  it('honors the supplied production-smoke environment and refuses a missing Credits scope before authenticated work', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).has('Cookie')).toBe(false);
      return new URL(String(url)).pathname.startsWith('/api/') ? new Response(null, { status: 401 }) : new Response('public');
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await expect(runProductionSmoke({ SMOKE_BASE_URL: base.baseUrl, SMOKE_SESSION_COOKIE: environment.PROCESSING_ACCEPTANCE_SESSION_COOKIE,
        PROCESSING_ACCEPTANCE_EXPECTED_UNIT: 'credits', PROCESSING_ACCEPTANCE_EXPECTED_AMOUNT: '100' }, fetcher, { requireAuthentication: true })).rejects.toMatchObject({ code: 'budget_authorization' });
    } finally { log.mockRestore(); }
  });
  it('does not report authenticated production smoke passed when its original Credits operation is UNKNOWN', async () => {
    const state = await fixture(); await creditBudget(state.ledgerPath);
    const delegate = site(state.sample, { creditsAmount: 100, status: 'UNKNOWN' });
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (['/api/upload-url', '/api/me/benefits', '/api/me/check-in'].includes(new URL(String(url)).pathname)) return new Response(null, { status: 401 });
      return delegate(url, init);
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await expect(runProductionSmoke({ SMOKE_BASE_URL: base.baseUrl, SMOKE_SESSION_COOKIE: environment.PROCESSING_ACCEPTANCE_SESSION_COOKIE }, fetcher,
        { ...base, ...state, requireAuthentication: true, expectedUnit: 'credits', expectedAmount: 100, creditBudgetId: 'credits-local-implementation-20261104', creditScopeId: ready.scopeId, creditEnvironment: 'sandbox' })).rejects.toThrow(/not confirmed|reconcile/i);
      expect(log.mock.calls.flat().join(' ')).not.toMatch(/Authenticated.*passed/);
      expect(JSON.parse(await readFile(state.ledgerPath, 'utf8'))).toMatchObject({ spendReservedUnknown: 100, realProviderInvocationsConsumed: 1 });
    } finally { log.mockRestore(); }
  });
  it('reserves the first reward before initialization while keeping processing closed until explicit scope review', async () => {
    const state = await fixture(); const budget = await creditBudget(state.ledgerPath, { readyScope: { ...ready, initialized: false } });
    await expect(budget.summary()).rejects.toThrow(/scope|initialized/i);
    const intent = await budget.reserveIssuance({ source: 'signup:reviewed-owner', amount: 100 });
    await budget.finishIssuance(intent, { amount: 100 });
    const ledger = JSON.parse(await readFile(state.ledgerPath, 'utf8'));
    expect(ledger.grossIssued).toBe(100); expect(ledger.issuanceReservedUnknown).toBe(0); expect(ledger.readyScope.initialized).toBe(false);
    await expect(budget.reserve('image', 'not initialized', { amount: 100, unit: 'credits', operation: 'image-watermark' })).rejects.toThrow(/scope|initialized/i);
  });
  it.each(['image-watermark', 'video-watermark'])('uses one reviewed aggregate spend for %s with a single balance', async operation => {
    const state = await fixture(); await creditBudget(state.ledgerPath);
    const amount = operation === 'video-watermark' ? 100 : 100;
    const fetcher = site(state.sample, { creditsAmount: amount, video: operation === 'video-watermark' });
    const probe = vi.fn().mockResolvedValue({ mimeType: 'video/mp4', width: 4, height: 2, durationSeconds: 2, frameRate: 24, videoCodec: 'h264', audio: [{ codec: 'aac' }] });
    const result = await runProcessingAcceptance({ ...base, ...state, operation, expectedAmount: amount, expectedUnit: 'credits', ffprobePath: '/opt/ffprobe',
      creditBudgetId: 'credits-local-implementation-20261104', creditScopeId: ready.scopeId, creditEnvironment: 'sandbox' }, { environment, fetcher, probeVideo: probe });
    expect(result).toMatchObject({ status: 'passed', creditsBefore: 1000, creditsAfter: 900, unit: 'credits' });
    const budget = JSON.parse(await readFile(state.ledgerPath, 'utf8'));
    expect(budget).toMatchObject({ grossSpent: 100, spendReservedUnknown: 0, realProviderInvocationsConsumed: 1 });
    expect(fetcher.mock.calls.filter(([url, init]) => String(url).endsWith('/api/v1/jobs') && init?.method === 'POST')).toHaveLength(1);
    expect(fetcher.mock.calls.find(([url]) => String(url).endsWith('/api/v1/me'))?.[1]?.headers).toMatchObject({ 'X-Credits-Contract': 'credits-v1' });
  });
  it('requires an existing initialized scope bound to the session before any API request', async () => {
    const state = await fixture(); const fetcher = vi.fn();
    await creditBudget(state.ledgerPath, { readyScope: undefined });
    await expect(runProcessingAcceptance({ ...base, ...state, expectedAmount: 100, expectedUnit: 'credits', creditBudgetId: 'credits-local-implementation-20261104', creditScopeId: ready.scopeId, creditEnvironment: 'sandbox' }, { environment, fetcher })).rejects.toMatchObject({ code: 'budget_authorization' });
    expect(fetcher).not.toHaveBeenCalled();
    const budget = await creditBudget(state.ledgerPath, { readyScope: { ...ready, sessionDigest: 'b'.repeat(64) } });
    await expect(budget.summary()).rejects.toThrow(/scope|session/i);
  });
  it('counts all operation spend and issuance separately; unknowns and refunds never reset totals', async () => {
    const state = await fixture(); const budget = await creditBudget(state.ledgerPath);
    const issuance = await budget.reserveIssuance({ source: 'signup:reviewed-owner', amount: 100 });
    await budget.finishIssuance(issuance, { amount: 100 });
    await budget.finishIssuance(issuance, { amount: 100 });
    const first = await budget.reserve('image', 'ordinary', { amount: 100, unit: 'credits', operation: 'image-watermark' });
    await budget.finish(first, { status: 'passed', creditsBefore: 1000, creditsAfter: 900 });
    await budget.finish(first, { status: 'passed', creditsBefore: 1000, creditsAfter: 900 });
    const unknown = await budget.reserve('image', 'lost response', { amount: 300, unit: 'credits', operation: 'image-watermark' });
    await budget.finish(unknown, { status: 'unknown' });
    const summary = await budget.summary();
    expect(summary).toMatchObject({ grossIssued: 100, grossSpent: 100, spendReservedUnknown: 300, realProviderInvocationsConsumed: 2 });
    await expect(budget.reserve('video', 'invalid kind', { amount: 100, unit: 'credits', operation: 'image-watermark' })).rejects.toThrow();
    await expect(budget.reserveIssuance({ source: 'signup:reviewed-owner', amount: 100 })).rejects.toThrow(/source|duplicate/i);
    await expect(budget.finish(first, { status: 'passed', creditsBefore: 1000, creditsAfter: 1000 })).rejects.toThrow();
  });
  it('serializes aggregate limits and holds all six Provider slots even after failures', async () => {
    const state = await fixture(); const budget = await creditBudget(state.ledgerPath);
    const attempts = await Promise.allSettled(Array.from({ length: 7 }, (_, i) => budget.reserve('image', `sample ${i}`, { amount: 300, unit: 'credits', operation: 'image-watermark' })));
    expect(attempts.filter(r => r.status === 'fulfilled')).toHaveLength(6);
    for (const result of attempts) if (result.status === 'fulfilled') await budget.finish(result.value, { status: 'failed' });
    expect(await budget.summary()).toMatchObject({ spendReservedUnknown: 1800, grossSpent: 0, realProviderInvocationsConsumed: 6 });
    const issuance = await budget.reserveIssuance({ source: 'admin:one', amount: 1900 });
    await expect(budget.reserveIssuance({ source: 'daily:two', amount: 101 })).rejects.toThrow(/budget/i);
    await budget.finishIssuance(issuance, { amount: 1900 });
    expect(await budget.summary()).toMatchObject({ grossIssued: 1900 });
  });
});

describe('authenticated v1 processing acceptance runner', () => {
  it.each(['background-removal', 'object-removal'])('accepts real %s PNG through one image budget slot and one purchased debit', async operation => {
    const state = await legacyFixture({ [operation]: { unit: 'purchasedImageCredits', amount: 10 } });
    const sample = await sharp({ create: { width: 4, height: 2, channels: 4, background: '#5577aa00' } }).png().toBuffer();
    await writeFile(state.samplePath, sample);
    const maskPath = join(state.directory, 'object-mask.png');
    await writeFile(maskPath, await sharp(Buffer.from([255,0,0,0,0,0,0,0]), {raw:{width:4,height:2,channels:1}}).png().toBuffer());
    const fetcher = site(sample, { png: true, purchased: true });
    const result = await runProcessingAcceptance({ ...base, ...state, operation, expectedAmount: 10, expectedUnit: 'purchasedImageCredits', ...(operation === 'object-removal' ? {maskPath} : {}) }, {environment, fetcher});
    expect(result).toMatchObject({status:'passed',operation,creditsBefore:100,creditsAfter:90,artifact:{format:'png',width:4,height:2}});
    expect(JSON.parse(await readFile(state.ledgerPath, 'utf8'))).toMatchObject({ grossSpent: 10, realProviderInvocationsConsumed: 1, events: [{ kind: 'image', amount: 10, unit: 'purchasedImageCredits', creditAmount: 10 }] });
    const submissions=fetcher.mock.calls.filter(([url,init])=>String(url).endsWith('/api/v1/jobs')&&init?.method==='POST'); expect(submissions).toHaveLength(1);
    if(operation === 'object-removal') {
      const uploads=fetcher.mock.calls.filter(([url,init])=>String(url).endsWith('/api/v1/uploads')&&init?.method==='POST');
      expect(JSON.parse(String(uploads[1][1]?.body))).toMatchObject({kind:'mask',inputArtifactId:'artifact-1'});
      const quote=fetcher.mock.calls.find(([url])=>String(url).endsWith('/api/v1/quotes'));
      expect(JSON.parse(String(quote?.[1]?.body))).toMatchObject({operation,maskArtifactId:'artifact-1'});
    }
  });
  it('refuses an object run without its selection, and background output without transparency', async () => {
    const state=await legacyFixture(); const fetcher=site(state.sample);
    await expect(runProcessingAcceptance({...base,...state,operation:'object-removal'},{environment,fetcher})).rejects.toMatchObject({code:'configuration'});
    expect(fetcher.mock.calls.some(([url,init])=>String(url).endsWith('/api/v1/jobs')&&init?.method==='POST')).toBe(false);
    const opaque=await sharp({create:{width:4,height:2,channels:3,background:'#ffffff'}}).png().toBuffer(); await writeFile(state.samplePath,opaque);
    await expect(runProcessingAcceptance({...base,...state,operation:'background-removal'},{environment,fetcher:site(opaque,{png:true})})).rejects.toMatchObject({code:'artifact_invalid'});
  });
  it('rejects an unrelated administrator debit during purchased PNG acceptance', async () => {
    const state=await legacyFixture({ 'background-removal': { unit: 'purchasedImageCredits', amount: 10 } });const sample=await sharp({create:{width:4,height:2,channels:4,background:'#ffffff00'}}).png().toBuffer();await writeFile(state.samplePath,sample);
    await expect(runProcessingAcceptance({...base,...state,operation:'background-removal',expectedAmount:10,expectedUnit:'purchasedImageCredits'},{environment,fetcher:site(sample,{png:true,purchased:true,unrelatedDebit:true})})).rejects.toMatchObject({code:'credit_invariant'});
  });
  it('defaults to public-only even when a session exists and never reserves a processing slot', async () => {
    const fetcher = site(new Uint8Array());
    const result = await runProcessingAcceptance({ baseUrl: 'https://example.test' }, { environment, fetcher });
    expect(result.status).toBe('public-passed');
    expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
    expect(fetcher.mock.calls.every(([, init]) => !init?.headers || !('Cookie' in init.headers))).toBe(true);
  });
  it('fails closed before any request when functional authentication or amount confirmation is missing', async () => {
    const fetcher = vi.fn();
    await expect(runProcessingAcceptance(base, { environment: {}, fetcher })).rejects.toThrow(/session/i);
    await expect(runProcessingAcceptance({ ...base, expectedAmount: undefined }, { environment, fetcher })).rejects.toThrow(/amount/i);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('uses one shared budget reservation, validates actual JPEG and confirms a single quoted debit', async () => {
    const state = await legacyFixture(); const fetcher = site(state.sample);
    const result = await runProcessingAcceptance({ ...base, ...state }, { environment, fetcher, sleep: vi.fn().mockResolvedValue(undefined) });
    expect(result).toMatchObject({ status: 'passed', operation: 'image-watermark', amount: 1, unit: 'freeUses', creditsBefore: 3, creditsAfter: 2, artifact: { format: 'jpeg', width: 4, height: 2 } });
    if (!('recordId' in result)) throw new Error('Functional result must identify its budget record');
    expect(fetcher.mock.calls.filter(([url, init]) => String(url).endsWith('/api/v1/jobs') && init?.method === 'POST')).toHaveLength(1);
    const summary = JSON.parse(await readFile(state.ledgerPath, 'utf8'));
    expect(summary).toMatchObject({ grossSpent: 100, realProviderInvocationsConsumed: 1 }); expect(summary.events[0]).toMatchObject({ status: 'passed', amount: 1, unit: 'freeUses', creditAmount: 100 });
    const report = await readFile(join(state.reportDir, `${result.recordId}.json`), 'utf8');
    expect(report).not.toContain('private'); expect(report).not.toContain('Signature'); expect(report).not.toContain('https://');
  });
  it('stops on UNKNOWN without another POST and keeps the reserved slot consumed', async () => {
    const state = await legacyFixture(); const fetcher = site(state.sample, { status: 'UNKNOWN' });
    const result = await runProcessingAcceptance({ ...base, ...state }, { environment, fetcher, sleep: vi.fn().mockResolvedValue(undefined) });
    expect(result.status).toBe('unknown');
    expect(fetcher.mock.calls.filter(([url, init]) => String(url).endsWith('/api/v1/jobs') && init?.method === 'POST')).toHaveLength(1);
    expect(JSON.parse(await readFile(state.ledgerPath, 'utf8')).events[0].status).toBe('unknown');
  });
  it('records a lost job-POST response as unknown without printing raw error data or retrying', async () => {
    const state = await legacyFixture(); const fetcher = site(state.sample, { lostSubmit: true });
    await expect(runProcessingAcceptance({ ...base, ...state }, { environment, fetcher })).rejects.toMatchObject({ code: 'submission_unknown' });
    expect(fetcher.mock.calls.filter(([url, init]) => String(url).endsWith('/api/v1/jobs') && init?.method === 'POST')).toHaveLength(1);
    const source = await readFile(state.ledgerPath, 'utf8'); expect(source).not.toContain('private');
    expect(JSON.parse(await readFile(state.ledgerPath, 'utf8')).events[0].status).toBe('unknown');
  });
  it('blocks before network work when the shared five-image budget has already been spent', async () => {
    const state = await fixture(); const budget = new AcceptanceBudget(state.ledgerPath);
    for (let index = 0; index < 5; index++) await budget.reserve('image', `previous sample ${index}`);
    const fetcher = vi.fn();
    await expect(runProcessingAcceptance({ ...base, ...state }, { environment, fetcher })).rejects.toMatchObject({ code: 'budget_authorization' });
    expect(fetcher).not.toHaveBeenCalled(); expect((await budget.summary()).used.image).toBe(5);
  });
  it('rejects malformed output bytes and an incorrect debit rather than reporting successful HTTP as passed', async () => {
    const first = await legacyFixture();
    await expect(runProcessingAcceptance({ ...base, ...first }, { environment, fetcher: site(first.sample, { invalidDownload: true }) })).rejects.toMatchObject({ code: 'artifact_invalid' });
    const second = await legacyFixture();
    await expect(runProcessingAcceptance({ ...base, ...second }, { environment, fetcher: site(second.sample, { balanceAfter: 1 }) })).rejects.toMatchObject({ code: 'credit_invariant' });
    expect(JSON.parse(await readFile(first.ledgerPath, 'utf8')).events[0].status).toBe('failed');
  });
  it('uses one video budget slot and probes both the actual input and downloaded MP4', async () => {
    const state = await legacyFixture();
    const probe = vi.fn().mockResolvedValue({ mimeType: 'video/mp4', width: 4, height: 2, durationSeconds: 2, frameRate: 24, videoCodec: 'h264', audio: [{ codec: 'aac' }] });
    const result = await runProcessingAcceptance({ ...base, ...state, operation: 'video-watermark', expectedUnit: 'processingCredits', ffprobePath: '/opt/ffprobe' }, { environment, fetcher: site(state.sample, { video: true }), probeVideo: probe });
    expect(result).toMatchObject({ status: 'passed', artifact: { format: 'mp4', hasAudio: true, durationSeconds: 2, fps: 24 } });
    expect(probe).toHaveBeenCalledTimes(2);
    expect(JSON.parse(await readFile(state.ledgerPath, 'utf8'))).toMatchObject({ grossSpent: 100, realProviderInvocationsConsumed: 1, events: [{ kind: 'video', amount: 1, unit: 'processingCredits', creditAmount: 100 }] });
  });
  it('binds a refinement mask to the parent result and includes the parent task in the quote', async () => {
    const state = await legacyFixture();
    const maskPath = join(state.directory, 'mask.png');
    await writeFile(maskPath, await sharp(Buffer.from([255, 0, 0, 0, 0, 0, 0, 0]), { raw: { width: 4, height: 2, channels: 1 } }).png().toBuffer());
    const fetcher = site(state.sample, { parent: true });
    await runProcessingAcceptance({ ...base, ...state, operation: 'image-refine', expectedUnit: 'processingCredits', parentJobId: 'parent-1', parentArtifactId: 'parent-result', maskPath }, { environment, fetcher });
    const upload = fetcher.mock.calls.find(([url, init]) => String(url).endsWith('/api/v1/uploads') && init?.method === 'POST');
    expect(JSON.parse(String(upload?.[1]?.body))).toMatchObject({ kind: 'mask', inputArtifactId: 'parent-result' });
    const quote = fetcher.mock.calls.find(([url]) => String(url).endsWith('/api/v1/quotes'));
    expect(JSON.parse(String(quote?.[1]?.body))).toMatchObject({ operation: 'image-refine', inputArtifactId: 'parent-result', parentJobId: 'parent-1', maskArtifactId: 'artifact-1' });
  });
  it('requires the settled job charge projection to match the confirmed quote', async () => {
    const state = await legacyFixture();
    await expect(runProcessingAcceptance({ ...base, ...state }, { environment, fetcher: site(state.sample, { incorrectCharge: true }) })).rejects.toMatchObject({ code: 'credit_invariant' });
  });
  it('requires CLI opt-in and never accepts a session through command-line arguments', () => {
    expect(acceptanceCliOptions([])).toEqual({ functional: false });
    expect(acceptanceCliOptions(['--functional', '--operation', 'image-watermark-pro', '--expected-amount', '3', '--expected-unit', 'processingCredits'])).toMatchObject({ functional: true, operation: 'image-watermark-pro', expectedAmount: 3 });
    expect(() => acceptanceCliOptions(['--cookie', 'private-value'])).toThrow('Unknown or incomplete acceptance argument');
    expect(acceptanceCliOptions(['--image-limit', '8'])).toMatchObject({ imageLimit: 8 });
  });
  it('writes the budget reservation and operation-key record before the only job POST', async () => {
    const state = await legacyFixture(); const respond = site(state.sample);
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/api/v1/jobs') && init?.method === 'POST') {
        const ledger = JSON.parse(await readFile(state.ledgerPath, 'utf8'));
        expect(ledger.events).toHaveLength(1); expect(ledger.events[0].status).toBe('reserved');
        const record = JSON.parse(await readFile(join(state.reportDir, `${ledger.events[0].id}.json`), 'utf8'));
        expect(record.clientOperationKey).toBe(JSON.parse(String(init.body)).idempotencyKey);
      }
      return respond(url, init);
    });
    await runProcessingAcceptance({ ...base, ...state }, { environment, fetcher });
    for (const [url, init] of fetcher.mock.calls) if (String(url).includes('r2.cloudflarestorage.com')) expect(init?.headers).not.toHaveProperty('Cookie');
  });
  it('does not reserve or submit when a fresh quote differs from the confirmed amount', async () => {
    const state = await legacyFixture({ 'image-watermark': { unit: 'processingCredits', amount: 2 } }); const fetcher = site(state.sample, { parent: true });
    await expect(runProcessingAcceptance({ ...base, ...state, expectedAmount: 2, expectedUnit: 'processingCredits' }, { environment, fetcher })).rejects.toMatchObject({ code: 'quote_changed' });
    expect(JSON.parse(await readFile(state.ledgerPath, 'utf8')).events).toHaveLength(0);
    expect(fetcher.mock.calls.some(([url, init]) => String(url).endsWith('/api/v1/jobs') && init?.method === 'POST')).toBe(false);
  });
  it('treats a temporary poll HTTP error as pending uncertainty without another job POST', async () => {
    const state = await legacyFixture(); const respond = site(state.sample);
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => String(url).endsWith('/api/v1/jobs/job-1') ? new Response('private provider diagnostic', { status: 503 }) : respond(url, init));
    await expect(runProcessingAcceptance({ ...base, ...state }, { environment, fetcher })).rejects.toMatchObject({ code: 'http_error' });
    expect(JSON.parse(await readFile(state.ledgerPath, 'utf8')).events[0].status).toBe('unknown');
    expect(fetcher.mock.calls.filter(([url, init]) => String(url).endsWith('/api/v1/jobs') && init?.method === 'POST')).toHaveLength(1);
  });
  it.each(['option', 'environment'])('keeps historical eight-image records offline while refusing functional authority through %s', async (source) => {
    const state = await fixture();
    await new AcceptanceBudget(state.ledgerPath).authorizeIncrease({ image: 8, video: 5 }, 'Explicit approval for additional image contract acceptance');
    const options = { ...base, ...state, ...(source === 'option' ? { imageLimit: 8 } : {}) };
    const env = { ...environment, ...(source === 'environment' ? { PROCESSING_ACCEPTANCE_IMAGE_LIMIT: '8' } : {}) };
    const fetcher = vi.fn();
    await expect(runProcessingAcceptance(options, { environment: env, fetcher })).rejects.toMatchObject({ code: 'budget_authorization' });
    expect(fetcher).not.toHaveBeenCalled();
    const historical = new AcceptanceBudget(state.ledgerPath, { image: 8, video: 5 });
    await historical.finish(await historical.reserve('image', 'offline historical fixture'), { status: 'passed' });
    const summary = await new AcceptanceBudget(state.ledgerPath, { image: 8, video: 5 }).summary();
    expect(summary.used).toEqual({ image: 1, video: 0 }); expect(summary.remaining).toEqual({ image: 7, video: 5 });
  });
  it('retains the historical ninth image offline without authorizing a functional request', async () => {
    const state = await fixture();
    const budget = new AcceptanceBudget(state.ledgerPath, { image: 8, video: 5 });
    for (let index = 0; index < 8; index++) await budget.reserve('image', `previous acceptance ${index}`);
    await budget.authorizeIncrease({ image: 9, video: 5 }, 'User approved one additional image for single-click production acceptance');
    const fetcher = vi.fn();
    await expect(runProcessingAcceptance({ ...base, ...state, imageLimit: 9 }, { environment, fetcher })).rejects.toMatchObject({ code: 'budget_authorization' });
    expect(fetcher).not.toHaveBeenCalled();
    await budget.finish(await budget.reserve('image', 'offline ninth fixture'), { status: 'passed' });
    const summary = await new AcceptanceBudget(state.ledgerPath, { image: 9, video: 5 }).summary();
    expect(summary.used).toEqual({ image: 9, video: 0 });
    expect(summary.remaining).toEqual({ image: 0, video: 5 });
    await expect(budget.reserve('image', 'unapproved extra acceptance')).rejects.toThrow(/exhausted/i);
  });
  it.each(['option', 'environment'])('preserves historical tenth-image authorization through %s as offline evidence only', async (source) => {
    const state = await fixture(); const budget = new AcceptanceBudget(state.ledgerPath, { image: 9, video: 5 });
    for (let index = 0; index < 9; index++) await budget.reserve('image', `previous approved image ${index}`);
    const previous = (await budget.summary()).records;
    const options = { ...base, ...state, ...(source === 'option' ? { imageLimit: 10 } : {}) };
    const env = { ...environment, ...(source === 'environment' ? { PROCESSING_ACCEPTANCE_IMAGE_LIMIT: '10' } : {}) };
    const fetcher = site(state.sample);
    await expect(runProcessingAcceptance(options, { environment: env, fetcher })).rejects.toMatchObject({ code: 'budget_authorization' });
    expect(fetcher).not.toHaveBeenCalled();
    await budget.authorizeIncrease({ image: 10, video: 5 }, 'User approved one additional image for project simplification acceptance');
    await expect(runProcessingAcceptance(options, { environment: env, fetcher })).rejects.toMatchObject({ code: 'budget_authorization' });
    expect(fetcher).not.toHaveBeenCalled();
    await budget.finish(await budget.reserve('image', 'offline tenth fixture'), { status: 'passed' });
    const summary = await new AcceptanceBudget(state.ledgerPath, { image: 10, video: 5 }).summary();
    expect(summary.used).toEqual({ image: 10, video: 0 }); expect(summary.remaining).toEqual({ image: 0, video: 5 });
    expect(summary.records.slice(0, 9)).toEqual(previous); expect(summary.records[9].status).toBe('passed');
    const exhaustedFetcher = vi.fn();
    await expect(runProcessingAcceptance(options, { environment: env, fetcher: exhaustedFetcher })).rejects.toMatchObject({ code: 'budget_authorization' });
    expect(exhaustedFetcher).not.toHaveBeenCalled();
  });
  it('retains historical free-use quote bookkeeping offline without granting functional authority', async () => {
    const state = await fixture(); const budget = new AcceptanceBudget(state.ledgerPath, { image: 1, video: 5 });
    await budget.reserve('image', 'original authorized call');
    await budget.authorizeImageCredits({ amount: 10, unit: 'processingCredits', additionalCalls: 5, reason: 'User approved processing Credits for the release checks' });
    const fetcher = vi.fn();
    await expect(runProcessingAcceptance({ ...base, ...state, imageLimit: 6 }, { environment, fetcher })).rejects.toMatchObject({ code: 'budget_authorization' });
    expect(fetcher).not.toHaveBeenCalled();
    await budget.finish(await budget.reserve('image', 'offline free-use fixture', { amount: 1, unit: 'freeUses' }), { status: 'passed' });
    const summary = await budget.summary();
    expect(summary.imageCreditBudget).toMatchObject({ unit: 'processingCredits', reserved: 0 });
    expect(summary.records.at(-1)).toMatchObject({ status: 'passed', creditUnit: 'freeUses', quotedAmount: 1, reservedCredits: 0 });
  });
  it('rejects an unapproved expanded image limit before any network request', async () => {
    const state = await fixture(); const fetcher = vi.fn();
    await expect(runProcessingAcceptance({ ...base, ...state, imageLimit: 11 }, { environment, fetcher })).rejects.toMatchObject({ code: 'budget_authorization' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
