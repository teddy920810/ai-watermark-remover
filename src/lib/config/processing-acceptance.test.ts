import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AcceptanceBudget } from '../../../scripts/lib/acceptance-budget.mjs';
import { acceptanceCliOptions, runProcessingAcceptance } from '../../../scripts/processing-acceptance.mjs';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'watermark-site-acceptance-'));
  directories.push(directory);
  const sample = await sharp({ create: { width: 4, height: 2, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
  const samplePath = join(directory, 'sample.jpg'); await writeFile(samplePath, sample);
  return { directory, sample, samplePath, ledgerPath: join(directory, 'budget.json'), reportDir: join(directory, 'reports') };
}
function site(sample: Uint8Array, options: { status?: string; lostSubmit?: boolean; balanceAfter?: number; invalidDownload?: boolean; video?: boolean; parent?: boolean; incorrectCharge?: boolean } = {}) {
  let submitted = false;
  let uploadNumber = 0;
  const metadata = { kind: options.video ? 'video' : 'image', contentType: options.video ? 'video/mp4' : 'image/jpeg', width: 4, height: 2, byteSize: sample.byteLength, ...(options.video ? { durationSeconds: 2, fps: 24, hasAudio: true } : {}) };
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const address = new URL(String(url));
    const route = address.pathname;
    if (address.hostname.endsWith('r2.cloudflarestorage.com')) {
      if (init?.method === 'PUT') return new Response(null, { status: 200 });
      return new Response(options.invalidDownload ? new Uint8Array([1, 2, 3]) : new Uint8Array(sample), { headers: { 'Content-Type': metadata.contentType } });
    }
    if (['/', '/robots.txt', '/sitemap.xml'].includes(route)) return new Response('public');
    if (route === '/api/v1/capabilities') return Response.json({ operations: [] });
    if (route === '/api/v1/me') return Response.json({ freeUses: submitted && !options.video && !options.parent ? options.balanceAfter ?? 2 : 3, processingCredits: submitted && (options.video || options.parent) ? options.balanceAfter ?? 99 : 100 });
    if (route === '/api/v1/uploads' && init?.method === 'POST') return Response.json({ id: `upload-${++uploadNumber}`, status: 'created', uploadUrl: 'https://account.r2.cloudflarestorage.com/private/input?X-Amz-Signature=private-upload' });
    if (/^\/api\/v1\/uploads\/upload-\d\/complete$/.test(route)) return Response.json({ status: 'validating' }, { status: 202 });
    if (/^\/api\/v1\/uploads\/upload-\d$/.test(route)) return Response.json({ id: 'upload-1', status: 'ready', artifact: { id: 'artifact-1', metadata } });
    if (route === '/api/v1/quotes') return Response.json({ id: 'quote-1', amount: 1, unit: options.video || options.parent ? 'processingCredits' : 'freeUses', isDemo: false, expectedOutput: metadata });
    if (route === '/api/v1/jobs' && init?.method === 'POST') { submitted = true; if (options.lostSubmit) throw new Error('private session=value; private signed URL'); return Response.json({ id: 'job-1', status: 'QUEUED' }, { status: 201 }); }
    if (route === '/api/v1/jobs/parent-1') return Response.json({ id: 'parent-1', status: 'READY', isDemo: false, result: { id: 'parent-result', canRefine: true, metadata } });
    if (route === '/api/v1/jobs/job-1') return Response.json({ id: 'job-1', status: options.status ?? 'READY', charge: { status: 'settled', amount: options.incorrectCharge ? 2 : 1, unit: options.video || options.parent ? 'processingCredits' : 'freeUses' }, isDemo: false, result: { id: 'result-1', metadata } });
    if (route === '/api/v1/jobs/job-1/download') return Response.json({ url: 'https://account.r2.cloudflarestorage.com/private/result?X-Amz-Signature=private-download' });
    throw new Error(`Unexpected test route ${route}`);
  });
  return fetcher;
}
const environment = { PROCESSING_ACCEPTANCE_SESSION_COOKIE: 'session=private' };
const base = { baseUrl: 'https://example.test', operation: 'image-watermark', functional: true, expectedAmount: 1, expectedUnit: 'freeUses', pollIntervalMs: 1, maxWaitMs: 10 };

describe('authenticated v1 processing acceptance runner', () => {
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
    const state = await fixture(); const fetcher = site(state.sample);
    const result = await runProcessingAcceptance({ ...base, ...state }, { environment, fetcher, sleep: vi.fn().mockResolvedValue(undefined) });
    expect(result).toMatchObject({ status: 'passed', operation: 'image-watermark', amount: 1, unit: 'freeUses', creditsBefore: 3, creditsAfter: 2, artifact: { format: 'jpeg', width: 4, height: 2 } });
    if (!('recordId' in result)) throw new Error('Functional result must identify its budget record');
    expect(fetcher.mock.calls.filter(([url, init]) => String(url).endsWith('/api/v1/jobs') && init?.method === 'POST')).toHaveLength(1);
    const summary = await new AcceptanceBudget(state.ledgerPath).summary();
    expect(summary.used).toEqual({ image: 1, video: 0 }); expect(summary.records[0].status).toBe('passed');
    const report = await readFile(join(state.reportDir, `${result.recordId}.json`), 'utf8');
    expect(report).not.toContain('private'); expect(report).not.toContain('Signature'); expect(report).not.toContain('https://');
  });
  it('stops on UNKNOWN without another POST and keeps the reserved slot consumed', async () => {
    const state = await fixture(); const fetcher = site(state.sample, { status: 'UNKNOWN' });
    const result = await runProcessingAcceptance({ ...base, ...state }, { environment, fetcher, sleep: vi.fn().mockResolvedValue(undefined) });
    expect(result.status).toBe('unknown');
    expect(fetcher.mock.calls.filter(([url, init]) => String(url).endsWith('/api/v1/jobs') && init?.method === 'POST')).toHaveLength(1);
    expect((await new AcceptanceBudget(state.ledgerPath).summary()).records[0].status).toBe('unknown');
  });
  it('records a lost job-POST response as unknown without printing raw error data or retrying', async () => {
    const state = await fixture(); const fetcher = site(state.sample, { lostSubmit: true });
    await expect(runProcessingAcceptance({ ...base, ...state }, { environment, fetcher })).rejects.toMatchObject({ code: 'submission_unknown' });
    expect(fetcher.mock.calls.filter(([url, init]) => String(url).endsWith('/api/v1/jobs') && init?.method === 'POST')).toHaveLength(1);
    const source = await readFile(state.ledgerPath, 'utf8'); expect(source).not.toContain('private');
    expect((await new AcceptanceBudget(state.ledgerPath).summary()).records[0].status).toBe('unknown');
  });
  it('blocks before network work when the shared five-image budget has already been spent', async () => {
    const state = await fixture(); const budget = new AcceptanceBudget(state.ledgerPath);
    for (let index = 0; index < 5; index++) await budget.reserve('image', `previous sample ${index}`);
    const fetcher = vi.fn();
    await expect(runProcessingAcceptance({ ...base, ...state }, { environment, fetcher })).rejects.toThrow(/budget/i);
    expect(fetcher).not.toHaveBeenCalled(); expect((await budget.summary()).used.image).toBe(5);
  });
  it('rejects malformed output bytes and an incorrect debit rather than reporting successful HTTP as passed', async () => {
    const first = await fixture();
    await expect(runProcessingAcceptance({ ...base, ...first }, { environment, fetcher: site(first.sample, { invalidDownload: true }) })).rejects.toMatchObject({ code: 'artifact_invalid' });
    const second = await fixture();
    await expect(runProcessingAcceptance({ ...base, ...second }, { environment, fetcher: site(second.sample, { balanceAfter: 1 }) })).rejects.toMatchObject({ code: 'credit_invariant' });
    expect((await new AcceptanceBudget(first.ledgerPath).summary()).records[0].status).toBe('failed');
  });
  it('uses one video budget slot and probes both the actual input and downloaded MP4', async () => {
    const state = await fixture();
    const probe = vi.fn().mockResolvedValue({ mimeType: 'video/mp4', width: 4, height: 2, durationSeconds: 2, frameRate: 24, videoCodec: 'h264', audio: [{ codec: 'aac' }] });
    const result = await runProcessingAcceptance({ ...base, ...state, operation: 'video-watermark', expectedUnit: 'processingCredits', ffprobePath: '/opt/ffprobe' }, { environment, fetcher: site(state.sample, { video: true }), probeVideo: probe });
    expect(result).toMatchObject({ status: 'passed', artifact: { format: 'mp4', hasAudio: true, durationSeconds: 2, fps: 24 } });
    expect(probe).toHaveBeenCalledTimes(2);
    expect((await new AcceptanceBudget(state.ledgerPath).summary()).used).toEqual({ image: 0, video: 1 });
  });
  it('binds a refinement mask to the parent result and includes the parent task in the quote', async () => {
    const state = await fixture();
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
    const state = await fixture();
    await expect(runProcessingAcceptance({ ...base, ...state }, { environment, fetcher: site(state.sample, { incorrectCharge: true }) })).rejects.toMatchObject({ code: 'credit_invariant' });
  });
  it('requires CLI opt-in and never accepts a session through command-line arguments', () => {
    expect(acceptanceCliOptions([])).toEqual({ functional: false });
    expect(acceptanceCliOptions(['--functional', '--operation', 'image-watermark-pro', '--expected-amount', '3', '--expected-unit', 'processingCredits'])).toMatchObject({ functional: true, operation: 'image-watermark-pro', expectedAmount: 3 });
    expect(() => acceptanceCliOptions(['--cookie', 'private-value'])).toThrow('Unknown or incomplete acceptance argument');
    expect(acceptanceCliOptions(['--image-limit', '8'])).toMatchObject({ imageLimit: 8 });
  });
  it('writes the budget reservation and operation-key record before the only job POST', async () => {
    const state = await fixture(); const respond = site(state.sample);
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/api/v1/jobs') && init?.method === 'POST') {
        const ledger = JSON.parse(await readFile(state.ledgerPath, 'utf8'));
        expect(ledger.records).toHaveLength(1); expect(ledger.records[0].status).toBe('started');
        const record = JSON.parse(await readFile(join(state.reportDir, `${ledger.records[0].id}.json`), 'utf8'));
        expect(record.clientOperationKey).toBe(JSON.parse(String(init.body)).idempotencyKey);
      }
      return respond(url, init);
    });
    await runProcessingAcceptance({ ...base, ...state }, { environment, fetcher });
    for (const [url, init] of fetcher.mock.calls) if (String(url).includes('r2.cloudflarestorage.com')) expect(init?.headers).not.toHaveProperty('Cookie');
  });
  it('does not reserve or submit when a fresh quote differs from the confirmed amount', async () => {
    const state = await fixture(); const fetcher = site(state.sample);
    await expect(runProcessingAcceptance({ ...base, ...state, expectedAmount: 2 }, { environment, fetcher })).rejects.toMatchObject({ code: 'quote_changed' });
    expect((await new AcceptanceBudget(state.ledgerPath).summary()).records).toHaveLength(0);
    expect(fetcher.mock.calls.some(([url, init]) => String(url).endsWith('/api/v1/jobs') && init?.method === 'POST')).toBe(false);
  });
  it('treats a temporary poll HTTP error as pending uncertainty without another job POST', async () => {
    const state = await fixture(); const respond = site(state.sample);
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => String(url).endsWith('/api/v1/jobs/job-1') ? new Response('private provider diagnostic', { status: 503 }) : respond(url, init));
    await expect(runProcessingAcceptance({ ...base, ...state }, { environment, fetcher })).rejects.toMatchObject({ code: 'http_error' });
    expect((await new AcceptanceBudget(state.ledgerPath).summary()).records[0].status).toBe('unknown');
    expect(fetcher.mock.calls.filter(([url, init]) => String(url).endsWith('/api/v1/jobs') && init?.method === 'POST')).toHaveLength(1);
  });
  it.each(['option', 'environment'])('uses the explicitly authorized eight-image ledger through %s without changing the video cap', async (source) => {
    const state = await fixture();
    await new AcceptanceBudget(state.ledgerPath).authorizeIncrease({ image: 8, video: 5 }, 'Explicit approval for additional image contract acceptance');
    const options = { ...base, ...state, ...(source === 'option' ? { imageLimit: 8 } : {}) };
    const env = { ...environment, ...(source === 'environment' ? { PROCESSING_ACCEPTANCE_IMAGE_LIMIT: '8' } : {}) };
    await runProcessingAcceptance(options, { environment: env, fetcher: site(state.sample) });
    const summary = await new AcceptanceBudget(state.ledgerPath, { image: 8, video: 5 }).summary();
    expect(summary.used).toEqual({ image: 1, video: 0 }); expect(summary.remaining).toEqual({ image: 7, video: 5 });
  });
  it('rejects image limits above the explicit supported maximum before any network request', async () => {
    const state = await fixture(); const fetcher = vi.fn();
    await expect(runProcessingAcceptance({ ...base, ...state, imageLimit: 9 }, { environment, fetcher })).rejects.toMatchObject({ code: 'budget_authorization' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
