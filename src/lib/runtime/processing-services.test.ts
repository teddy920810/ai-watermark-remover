import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { S3Client } from '@aws-sdk/client-s3';
import { createProcessingRuntime } from './processing-services';
import { CloudRunTriggerError } from './cloud-run-trigger';
import type { ProcessingRuntimeConfig } from './processing-services';
import { memoryMediaStore } from './test-fixtures';
import { MemoryFinance, NOW } from '../processing/test-fixtures';
import type { UploadRecord } from './media-preflight';
import type { ProcessingFinancialStore } from '../processing/contracts';

async function setup(overrides: Partial<ProcessingRuntimeConfig> = {}) {
  const memory = memoryMediaStore(); const finance = new MemoryFinance(); finance.freeBalances.set('user-1', 1);
  let next = 0;
  const send = vi.fn(async (command: { constructor: { name: string }; input: unknown }) => {
    if (command.constructor.name === 'ListObjectsV2Command') {
      const input = command.input as { Prefix: string; MaxKeys: number };
      return { Contents: [...memory.objects.keys()].filter((k) => k.startsWith(input.Prefix)).sort().slice(0, input.MaxKeys).map((Key) => ({ Key })), IsTruncated: false };
    }
    const response = await memory.send(command);
    if (command.constructor.name === 'GetObjectCommand') {
      const body = response.Body!;
      Object.assign(body, { transformToString: () => new Response(body).text() });
    }
    return response;
  });
  const benefits = { getSummary: vi.fn(async () => ({ balance: finance.freeBalances.get('user-1') ?? 0, cap: 3, dailyReward: 1, checkedInToday: false })) };
  const signUrl = vi.fn(async () => `https://private-r2.test/signed-${++next}`);
  const config: ProcessingRuntimeConfig = { r2: { endpoint: 'https://private-r2.test', accessKeyId: 'not-real-access', secretAccessKey: 'not-real-secret', bucket: 'private-bucket' }, databaseUrl: 'postgres://unused.test/database', providerMode: 'mock', enabled: true,
    dependencies: { client: { send } as unknown as S3Client, finance, benefits, signUrl, now: () => new Date(NOW), id: () => `id-${++next}` }, ...overrides };
  const runtime = createProcessingRuntime(config);
  const bytes = await sharp({ create: { width: 8, height: 6, channels: 4, background: '#55aaff88' } }).png().toBuffer();
  const upload = await runtime.beginUpload('user-1', { kind: 'image', contentType: 'image/png', byteSize: bytes.byteLength }) as { id: string; uploadUrl: string };
  const record = JSON.parse(new TextDecoder().decode(memory.objects.get(`processing/uploads/${upload.id}.json`)!.bytes)) as UploadRecord;
  memory.objects.set(record.stagingKey, { bytes, contentType: 'image/png', metadata: {}, etag: 'browser-upload' });
  return { runtime, finance, memory, benefits, config, upload, record, bytes, signUrl };
}

describe('processing runtime assembly', () => {
  it.each(['worker', 'dispatcher'] as const)('clears an expired preflight from durable delivery through the %s without probing or charging', async (path) => {
    const trigger = vi.fn(async () => ({ nextCheckAt: NOW })); const s = await setup({ trigger });
    await s.runtime.completeUpload('user-1', s.upload.id);
    const later = createProcessingRuntime({ ...s.config, dependencies: { ...s.config.dependencies, now: () => new Date('2026-10-24T01:00:01.000Z') } });
    vi.spyOn(s.finance as ProcessingFinancialStore, 'claimDue').mockResolvedValue([{ id: 'preflight-outbox', jobId: s.upload.id, ownerId: 'user-1', action: 'preflight', attempts: 12 }]);
    const retry = vi.spyOn(s.finance, 'retryDispatch');
    if (path === 'worker') expect(await later.runPreflight('user-1', s.upload.id)).toMatchObject({ status: 'expired' }); else await later.dispatch();
    expect(s.finance.outbox.has(s.upload.id)).toBe(false); expect(trigger).not.toHaveBeenCalled(); expect(retry).not.toHaveBeenCalled(); expect(s.finance.admissions.size).toBe(0);
    expect(s.memory.objects.has(s.record.stagingKey)).toBe(false);
    await expect(later.getUpload('user-1', s.upload.id)).rejects.toMatchObject({ status: 410 }); await later.close();
  });
  it('signs a nonempty browser upload without an empty-body CRC32 requirement using the real SDK signer', async () => {
    const send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({ ETag: 'offline-etag' } as never);
    const runtime = createProcessingRuntime({ r2: { endpoint: 'https://offline-account.r2.cloudflarestorage.com', accessKeyId: 'fake-access', secretAccessKey: 'fake-secret', bucket: 'private' }, databaseUrl: 'postgres://unused.invalid/database', providerMode: 'mock', enabled: true, dependencies: { finance: new MemoryFinance(), benefits: { getSummary: vi.fn() } } });
    try {
      const upload = await runtime.beginUpload('user-1', { kind: 'image', contentType: 'image/jpeg', byteSize: 1234 });
      const query = new URL(upload.uploadUrl).searchParams;
      expect(query.has('x-amz-checksum-crc32')).toBe(false); expect(query.has('x-amz-sdk-checksum-algorithm')).toBe(false); expect(query.get('X-Amz-Content-Sha256')).toBe('UNSIGNED-PAYLOAD');
    } finally { await runtime.close(); send.mockRestore(); }
  });
  it('uses existing benefit identity initialization without issuing processing credits', async () => {
    const s = await setup(); s.finance.balances.set('user-1', 0);
    await s.runtime.ensureAccountIdentity('user-1', 'Person@Example.com');
    expect(s.benefits.getSummary).toHaveBeenCalledWith('user-1', 'Person@Example.com');
    expect(await s.runtime.balances('user-1')).toEqual({ freeUses: 1, processingCredits: 0 });
  });
  it('only queues upload completion and performs decoding later in the worker', async () => {
    const s = await setup();
    expect(await s.runtime.completeUpload('user-1', s.upload.id)).toMatchObject({ status: 'validating' });
    expect(s.finance.outbox.has(s.upload.id)).toBe(true); expect(s.finance.admissions.size).toBe(0);
    expect([...s.memory.objects.keys()].some((k) => k.startsWith('processing/artifacts/'))).toBe(false);
    expect(await s.runtime.runPreflight('user-1', s.upload.id)).toMatchObject({ status: 'ready', artifact: { previewUrl: expect.stringContaining('https://private-r2.test/') } });
    const publicUpload = await s.runtime.getUpload('user-1', s.upload.id);
    expect(JSON.stringify(publicUpload)).not.toContain('stagingKey'); expect(JSON.stringify(publicUpload)).not.toContain('ownerId');
    await expect(s.runtime.getUpload('other', s.upload.id)).rejects.toMatchObject({ status: 404 });
  });
  it('runs a complete mock job with real private result bytes, proper JPG output and fresh downloads', async () => {
    const s = await setup(); await s.runtime.completeUpload('user-1', s.upload.id);
    const ready = await s.runtime.runPreflight('user-1', s.upload.id);
    const q = await s.runtime.service.quote({ ownerId: 'user-1', operation: 'image-watermark', inputArtifactId: ready.artifactId! });
    const publicQuote = await s.runtime.projectQuote('user-1', q);
    expect(publicQuote).toMatchObject({ unit: 'freeUses', isDemo: true, expectedOutput: { format: 'JPG', width: 8, height: 6 } });
    const job = await s.runtime.service.submit({ ownerId: 'user-1', quoteId: q.id, idempotencyKey: 'click' });
    const result = await s.runtime.runJob(job.id);
    expect(result.status).toBe('READY'); expect(s.finance.settlements).toBe(1);
    expect((await s.runtime.service.get('user-1', job.id)).status).toBe('READY');
    expect((await s.runtime.service.list('user-1')).map((item) => item.id)).toEqual([job.id]);
    expect(await s.runtime.service.list('another-user')).toEqual([]);
    expect(await s.runtime.projectJob('user-1', result)).toMatchObject({ isDemo: true, result: { contentType: 'image/jpeg', width: 8, height: 6, canRefine: true } });
    const a = await s.runtime.download('user-1', job.id); const b = await s.runtime.download('user-1', job.id);
    expect(a).not.toEqual(b); expect(a).toMatchObject({ filename: 'cleaned-image.jpg' });
    await expect(s.runtime.download('other', job.id)).rejects.toMatchObject({ status: 404 });
    await s.runtime.close();
  });
  it('leaves durable work untouched when no execution trigger is configured', async () => {
    const s = await setup(); const claim = vi.spyOn(s.finance, 'claimDue'); await s.runtime.dispatch();
    expect(claim).not.toHaveBeenCalled();
    expect(await s.runtime.balances('user-1')).toEqual({ processingCredits: 100, freeUses: 1 }); expect(s.benefits.getSummary).toHaveBeenCalledWith('user-1');
  });
  it('dispatches or reconciles the stored execution instead of silently creating another operation', async () => {
    const trigger = vi.fn(async () => ({ executionRef: 'cloud-execution-1', nextCheckAt: '2026-10-24T00:01:00.000Z' }));
    const s = await setup({ trigger });
    vi.spyOn(s.finance as ProcessingFinancialStore, 'claimDue').mockResolvedValue([{ id: 'outbox-1', jobId: s.upload.id, ownerId: 'user-1', action: 'preflight', attempts: 1, executionRef: 'existing-execution' }]);
    const dispatch = vi.spyOn(s.finance, 'recordDispatch'); await s.runtime.dispatch();
    expect(trigger).toHaveBeenCalledWith('preflight', s.upload.id, 'user-1', 'existing-execution'); expect(dispatch).toHaveBeenCalled(); expect(s.finance.admissions.size).toBe(0);
  });
  it('keeps failed execution dispatch in the outbox for scheduled recovery', async () => {
    const s = await setup({ trigger: vi.fn().mockRejectedValue(new Error('secret upstream URL')) });
    vi.spyOn(s.finance as ProcessingFinancialStore, 'claimDue').mockResolvedValue([{ id: 'outbox-1', jobId: s.upload.id, ownerId: 'user-1', action: 'preflight', attempts: 1 }]);
    const retry = vi.spyOn(s.finance, 'retryDispatch'); await s.runtime.dispatch();
    expect(retry).toHaveBeenCalledWith('outbox-1', expect.any(String), expect.any(String), 'dispatch_unavailable');
  });
  it.each([
    ['oidc_exchange', 401, 'dispatch_oidc_exchange_401'],
    ['google_sts', 403, 'dispatch_google_sts_403'],
    ['google_impersonation', 403, 'dispatch_google_impersonation_403'],
    ['cloud_run_http', 403, 'dispatch_cloud_run_http_403'],
    ['oidc_unavailable', 'private signed URL', 'dispatch_oidc_unavailable'],
    ['private signed URL', 401, 'dispatch_unavailable'],
    ['google_token_unknown', 999, 'dispatch_google_token_unknown'],
  ] as const)('stores only allowlisted dispatch phase %s and numeric status', async (phase, status, diagnostic) => {
    const error = new CloudRunTriggerError('private token and upstream URL', 'authorization', phase as 'oidc_exchange', status as number);
    const s = await setup({ trigger: vi.fn().mockRejectedValue(error) });
    vi.spyOn(s.finance as ProcessingFinancialStore, 'claimDue').mockResolvedValue([{ id: 'outbox-1', jobId: s.upload.id, ownerId: 'user-1', action: 'preflight', attempts: 1 }]);
    const retry = vi.spyOn(s.finance, 'retryDispatch'); await s.runtime.dispatch();
    expect(retry).toHaveBeenCalledWith('outbox-1', expect.any(String), new Date(Date.parse(NOW) + 60_000).toISOString(), diagnostic);
    expect(s.finance.admissions.size).toBe(0);
  });
  it('does not trust phase-shaped arbitrary thrown data', async () => {
    const s = await setup({ trigger: vi.fn().mockRejectedValue({ phase: 'oidc_exchange', status: 401, message: 'private token URL' }) });
    vi.spyOn(s.finance as ProcessingFinancialStore, 'claimDue').mockResolvedValue([{ id: 'outbox-1', jobId: s.upload.id, ownerId: 'user-1', action: 'preflight', attempts: 1 }]);
    const retry = vi.spyOn(s.finance, 'retryDispatch'); await s.runtime.dispatch();
    expect(retry).toHaveBeenCalledWith('outbox-1', expect.any(String), expect.any(String), 'dispatch_unavailable');
  });
  it.each([
    ['invalid_grant', 'dispatch_google_sts_400_invalid_grant'],
    ['private signed URL', 'dispatch_google_sts_400'],
  ] as const)('persists only allowlisted token reason %s', async (reason, diagnostic) => {
    const error = new CloudRunTriggerError('private token and upstream URL', 'authorization', 'google_sts', 400, reason as 'invalid_grant');
    const s = await setup({ trigger: vi.fn().mockRejectedValue(error) });
    vi.spyOn(s.finance as ProcessingFinancialStore, 'claimDue').mockResolvedValue([{ id: 'outbox-1', jobId: s.upload.id, ownerId: 'user-1', action: 'preflight', attempts: 1 }]);
    const retry = vi.spyOn(s.finance, 'retryDispatch'); await s.runtime.dispatch();
    expect(retry).toHaveBeenCalledWith('outbox-1', expect.any(String), expect.any(String), diagnostic);
  });
  it.each([[1, 60], [2, 120], [10, 900], [1000, 900]])('backs off dispatch attempt %s by %s seconds without losing its execution reference', async (attempts, seconds) => {
    const trigger = vi.fn().mockRejectedValue(new Error('temporary execution outage')); const s = await setup({ trigger });
    vi.spyOn(s.finance as ProcessingFinancialStore, 'claimDue').mockResolvedValue([{ id: 'outbox-1', jobId: s.upload.id, ownerId: 'user-1', action: 'preflight', attempts, executionRef: 'existing-execution' }]);
    const retry = vi.spyOn(s.finance, 'retryDispatch'); await s.runtime.dispatch();
    expect(trigger).toHaveBeenCalledWith('preflight', s.upload.id, 'user-1', 'existing-execution');
    expect(retry).toHaveBeenCalledWith('outbox-1', expect.any(String), new Date(Date.parse(NOW) + seconds * 1000).toISOString(), 'dispatch_unavailable');
  });
  it('keeps real operations disabled without an API key instead of exposing configuration secrets', async () => {
    const s = await setup(); const disabled = createProcessingRuntime({ ...s.config, providerMode: 'dewatermark', apiKey: undefined });
    expect(disabled.service.capabilities().every((c) => !c.enabled)).toBe(true);
    await expect(disabled.beginUpload('user-1', { kind: 'video', contentType: 'video/mp4', byteSize: 1 })).rejects.toMatchObject({ code: 'operation_unavailable' });
    await disabled.close();
  });
  it('does not dispatch another execution for a preflight that is already complete', async () => {
    const trigger = vi.fn(async () => ({ nextCheckAt: NOW })); const s = await setup({ trigger });
    await s.runtime.completeUpload('user-1', s.upload.id); await s.runtime.runPreflight('user-1', s.upload.id);
    vi.spyOn(s.finance as ProcessingFinancialStore, 'claimDue').mockResolvedValue([{ id: 'outbox-1', jobId: s.upload.id, ownerId: 'user-1', action: 'preflight', attempts: 1, executionRef: 'old-execution' }]);
    await s.runtime.dispatch(); expect(trigger).not.toHaveBeenCalled(); expect(s.finance.outbox.has(s.upload.id)).toBe(false);
  });
  it('keeps incompatible uploaded bytes out of quotes and refunds no financial reservation', async () => {
    const s = await setup(); s.memory.objects.get(s.record.stagingKey)!.bytes = Buffer.from('not an image');
    await s.runtime.completeUpload('user-1', s.upload.id);
    expect(await s.runtime.runPreflight('user-1', s.upload.id)).toMatchObject({ status: 'failed', error: expect.any(String) });
    expect(s.finance.admissions.size).toBe(0); expect(s.finance.refunds).toBe(0);
  });
  it('keeps a temporary storage failure recoverable in preflight instead of abandoning its durable delivery', async () => {
    const trigger = vi.fn(async () => ({ nextCheckAt: '2026-10-24T00:01:00.000Z' })); const s = await setup({ trigger });
    await s.runtime.completeUpload('user-1', s.upload.id);
    const original = s.memory.send.getMockImplementation()!; let failed = false;
    s.memory.send.mockImplementation(async (command) => {
      if (!failed && command.constructor.name === 'HeadObjectCommand') { failed = true; throw new Error('Temporary storage outage'); }
      return original(command);
    });
    await expect(s.runtime.runPreflight('user-1', s.upload.id)).rejects.toMatchObject({ status: 503 });
    expect(await s.runtime.getUpload('user-1', s.upload.id)).toMatchObject({ status: 'validating' });
    expect(s.finance.outbox.has(s.upload.id)).toBe(true);
    vi.spyOn(s.finance as ProcessingFinancialStore, 'claimDue').mockResolvedValue([{ id: 'outbox-1', jobId: s.upload.id, ownerId: 'user-1', action: 'preflight', attempts: 1 }]);
    await s.runtime.dispatch(); expect(trigger).toHaveBeenCalled();
    expect(await s.runtime.runPreflight('user-1', s.upload.id)).toMatchObject({ status: 'ready' });
  });
  it('constructs the production SDK adapters without startup requests and supports an explicit global stop', async () => {
    const runtime = createProcessingRuntime({ r2: { endpoint: 'https://unused-r2.invalid', accessKeyId: 'test-access', secretAccessKey: 'server-only-secret', bucket: 'private' }, databaseUrl: 'postgres://unused.invalid/test', providerMode: 'dewatermark', apiKey: 'server-only-provider-key', enabled: false });
    expect(runtime.service.capabilities()).toHaveLength(4); expect(runtime.service.capabilities().every((c) => !c.enabled)).toBe(true);
    const publicConfig = JSON.stringify(runtime.service.capabilities()); expect(publicConfig).not.toContain('server-only');
    await runtime.close();
  });
});
