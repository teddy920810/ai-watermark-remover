import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { S3Client } from '@aws-sdk/client-s3';
import { createProcessingRuntime } from './processing-services';
import { CloudRunTriggerError, createCloudRunTrigger } from './cloud-run-trigger';
import type { ProcessingRuntimeConfig } from './processing-services';
import { memoryMediaStore } from './test-fixtures';
import { MemoryFinance, NOW } from '../processing/test-fixtures';
import type { UploadRecord } from './media-preflight';
import type { ProcessingFinancialStore, ProcessingJob } from '../processing/contracts';
import type { ExecutionTrigger } from './processing-services';
import { durableOperationIds } from '../contracts/operation-catalog';
import { readImageProviderConfig } from '../config/image-providers';

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

async function queueProcessing(s: Awaited<ReturnType<typeof setup>>, operation: 'image-watermark' | 'image-watermark-pro' = 'image-watermark-pro') {
  await s.runtime.completeUpload('user-1', s.upload.id);
  const ready = await s.runtime.runPreflight('user-1', s.upload.id);
  const quote = await s.runtime.service.quote({ ownerId: 'user-1', operation, inputArtifactId: ready.artifactId! });
  const job = await s.runtime.service.submit({ ownerId: 'user-1', quoteId: quote.id, idempotencyKey: 'dispatch-test' });
  vi.spyOn(s.finance as ProcessingFinancialStore, 'claimDue').mockResolvedValue([{ id: 'process-outbox', jobId: job.id, ownerId: job.ownerId, action: 'process', attempts: 1 }]);
  return job;
}
function replaceJob(s: Awaited<ReturnType<typeof setup>>, job: ProcessingJob) {
  const key = `processing/jobs/${job.id}.json`; const stored = s.memory.objects.get(key)!;
  s.memory.objects.set(key, { ...stored, bytes: Buffer.from(JSON.stringify(job)), etag: `${stored.etag}-updated` });
}


async function imageRequest(s: Awaited<ReturnType<typeof setup>>, operation: 'background-removal' | 'object-removal', inputArtifactId: string) {
  if (operation === 'background-removal') return { operation, inputArtifactId };
  const bytes = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const upload = await s.runtime.beginUpload('user-1', { kind: 'mask', contentType: 'image/png', byteSize: bytes.length, inputArtifactId });
  const record = JSON.parse(Buffer.from(s.memory.objects.get(`processing/uploads/${upload.id}.json`)!.bytes).toString()) as UploadRecord;
  s.memory.objects.set(record.stagingKey, { bytes, contentType: 'image/png', metadata: {}, etag: 'mask-browser-upload' });
  await s.runtime.completeUpload('user-1', upload.id);
  const mask = await s.runtime.runPreflight('user-1', upload.id);
  return { operation, inputArtifactId, maskArtifactId: mask.artifactId! };
}

describe('processing runtime assembly', () => {
  describe.each(['background-removal', 'object-removal'] as const)('%s runtime', operation => {
  it('runs background removal through durable financial admission with its configured fee and PNG output', async () => {
    const s = await setup({ imageCredits: { enabled: true, environment: 'sandbox', costs: { 'watermark-removal': 100, 'background-removal': 10, 'object-removal': 4 }, priceVersion: 'image-operation-1' } });
    s.finance.freeBalances.set('user-1', 0); s.finance.imageBalances.set('user-1', 20);
    try {
      await s.runtime.completeUpload('user-1', s.upload.id);
      const input = await s.runtime.runPreflight('user-1', s.upload.id);
      const quote = await s.runtime.service.quote({ ownerId: 'user-1', ...await imageRequest(s, operation, input.artifactId!) });
      expect(quote).toMatchObject({ amount: operation === 'object-removal' ? 4 : 10, unit: 'purchasedImageCredits' });
      const job = await s.runtime.service.submit({ ownerId: 'user-1', quoteId: quote.id, idempotencyKey: 'background-finance' });
      const result = await s.runtime.runJob(job.id);
      expect(result).toMatchObject({ status: 'READY', chargeStatus: 'settled' });
      const projected = await s.runtime.projectJob('user-1', result);
      expect(projected).toMatchObject({ isDemo: true, result: { format: 'PNG', metadata: { width: 8, height: 6, contentType: 'image/png' }, canRefine: false } });
      expect(await s.finance.getBalance('user-1', 'purchasedImageCredits')).toBe(operation === 'object-removal' ? 16 : 10);
      expect(await s.finance.getBalance('user-1')).toBe(100);
    } finally { await s.runtime.close(); }
  });
  it('admits a configured background operation independently of the watermark Provider and marks its own demo status', async () => {
    const s = await setup({ providerMode: 'dewatermark', apiKey: undefined });
    try {
      expect(s.runtime.service.capabilities().find(value => value.operation === operation)?.enabled).toBe(true);
      expect(s.runtime.service.capabilities().find(value => value.operation === 'image-watermark')?.enabled).toBe(false);
      await s.runtime.completeUpload('user-1', s.upload.id);
      const input = await s.runtime.runPreflight('user-1', s.upload.id);
      const quote = await s.runtime.service.quote({ ownerId: 'user-1', ...await imageRequest(s, operation, input.artifactId!) });
      expect(await s.runtime.projectQuote('user-1', quote)).toMatchObject({ isDemo: true });
    } finally { await s.runtime.close(); }
  });
  it('recovers an in-flight mock background receipt after configuration changes without a vendor request', async () => {
    const s = await setup(); let later: ReturnType<typeof createProcessingRuntime> | undefined;
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error('A mock attempt must stay mock')); vi.stubGlobal('fetch', request);
    try {
      await s.runtime.completeUpload('user-1', s.upload.id); const input = await s.runtime.runPreflight('user-1', s.upload.id);
      const quote = await s.runtime.service.quote({ ownerId: 'user-1', ...await imageRequest(s, operation, input.artifactId!) });
      const job = await s.runtime.service.submit({ ownerId: 'user-1', quoteId: quote.id, idempotencyKey: 'mock-background-recovery' });
      const original = s.memory.send.getMockImplementation()!; let failed = false;
      s.memory.send.mockImplementation(async command => {
        if (!failed && command.constructor.name === 'PutObjectCommand' && String((command.input as { Key?: string }).Key).startsWith('processing/attempts/')) { failed = true; throw new Error('Attempt receipt storage interrupted'); }
        return original(command);
      });
      expect(await s.runtime.runJob(job.id)).toMatchObject({ status: 'UNKNOWN', attempt: { checkpoint: { provider: 'mock' } } });
      later = createProcessingRuntime({ ...s.config, imageProviders: readImageProviderConfig({ REPLICATE_API_TOKEN: 'fixture' }), dependencies: { ...s.config.dependencies, now: () => new Date(Date.parse(NOW) + 61_000) } });
      const restored = await later.runJob(job.id);
      expect(restored).toMatchObject({ status: 'READY', chargeStatus: 'settled' });
      expect(await later.projectJob('user-1', restored)).toMatchObject({ isDemo: true, result: { format: 'PNG' } });
      expect(request).not.toHaveBeenCalled(); expect(s.finance.settlements).toBe(1);
    } finally { await s.runtime.close(); await later?.close(); vi.unstubAllGlobals(); }
  });
  it('polls an accepted Replicate background prediction after a mock switch without changing its demo or charge identity', async () => {
    const request = vi.fn<typeof fetch>(); vi.stubGlobal('fetch', request);
    const imageProviders = readImageProviderConfig({ REPLICATE_API_TOKEN: 'fixture' });
    const s = await setup({ imageProviders }); let later: ReturnType<typeof createProcessingRuntime> | undefined;
    try {
      request.mockResolvedValueOnce(Response.json({ id: 'accepted-background', status: 'processing' }));
      await s.runtime.completeUpload('user-1', s.upload.id); const input = await s.runtime.runPreflight('user-1', s.upload.id);
      const quote = await s.runtime.service.quote({ ownerId: 'user-1', ...await imageRequest(s, operation, input.artifactId!) });
      const job = await s.runtime.service.submit({ ownerId: 'user-1', quoteId: quote.id, idempotencyKey: 'real-background-recovery' });
      expect(await s.runtime.runJob(job.id)).toMatchObject({ status: 'PROCESSING', attempt: { checkpoint: { provider: 'replicate', providerJobId: 'accepted-background' } } });
      expect(JSON.parse(String(request.mock.calls[0][1]?.body)).version).toBe(operation === 'object-removal' ? `allenhooo/lama:${imageProviders.REPLICATE_LAMA_MODEL_VERSION}` : `851-labs/background-remover:${imageProviders.REPLICATE_BACKGROUND_MODEL_VERSION}`);
      request.mockResolvedValueOnce(Response.json({ id: 'accepted-background', status: 'succeeded', output: 'https://replicate.delivery/background.png' })).mockResolvedValueOnce(new Response(s.bytes));
      later = createProcessingRuntime({ ...s.config, imageProviders: { ...imageProviders, BACKGROUND_REMOVAL_PROVIDER: 'mock', OBJECT_REMOVAL_PROVIDER: 'mock' }, dependencies: { ...s.config.dependencies, now: () => new Date(Date.parse(NOW) + 61_000) } });
      const restored = await later.runJob(job.id);
      expect(restored.status).toBe('READY'); expect(await later.projectJob('user-1', restored)).toMatchObject({ isDemo: false, result: { format: 'PNG' } });
      expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1); expect(s.finance.settlements).toBe(1);
    } finally { await s.runtime.close(); await later?.close(); vi.unstubAllGlobals(); }
  });
  });
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
    expect(await s.runtime.balances('user-1', 'Person@Example.com')).toEqual({ freeUses: 1, processingCredits: 0 });
    expect(s.benefits.getSummary).toHaveBeenCalledWith('user-1', 'Person@Example.com');
    expect(s.benefits.getSummary).toHaveBeenCalledOnce();
  });
  it('quotes and polls durable work without repeatedly initializing benefits', async () => {
    const s = await setup(); const job = await queueProcessing(s, 'image-watermark');
    expect(await s.runtime.getUpload('user-1', s.upload.id)).toMatchObject({ status: 'ready' });
    expect((await s.runtime.service.get('user-1', job.id)).id).toBe(job.id);
    expect(await s.runtime.service.list('user-1')).toHaveLength(1);
    expect(s.benefits.getSummary).not.toHaveBeenCalled();
    expect(job.quote.unit).toBe('freeUses'); expect(s.finance.freeBalances.get('user-1')).toBe(0);
    await s.runtime.close();
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
    expect(await s.runtime.balances('user-1')).toEqual({ processingCredits: 100, freeUses: 1 }); expect(s.benefits.getSummary).toHaveBeenCalledWith('user-1', undefined);
  });
  it.each(['authorization', 'http-403'] as const)('retries a definitely unaccepted %s dispatch with a fresh durable nonce and one reservation', async (failure) => {
    const execution = 'projects/demo-project/locations/asia-east1/jobs/watermark-worker/executions/accepted';
    const getAccessToken = vi.fn(async () => 'private-test-token');
    if (failure === 'authorization') getAccessToken.mockRejectedValueOnce(new CloudRunTriggerError('private credential failure', 'authorization', 'google_sts', 403));
    const request = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return Response.json({ metadata: { name: execution } });
      return Response.json({ name: execution, runningCount: 1 });
    });
    if (failure === 'http-403') request.mockResolvedValueOnce(new Response('private refusal', { status: 403 }));
    const trigger = createCloudRunTrigger({ projectId: 'demo-project', region: 'asia-east1', jobName: 'watermark-worker', fetchImpl: request as typeof fetch, getAccessToken, now: () => new Date(NOW) });
    const s = await setup({ trigger }); const reserve = vi.spyOn(s.finance, 'reserveAndEnqueue'); const job = await queueProcessing(s);
    await s.runtime.dispatch(); const refused = (await s.runtime.service.get('user-1', job.id)).dispatch!;
    expect(refused.terminal).toBe(true);
    expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(failure === 'authorization' ? 0 : 1);
    await s.runtime.dispatch(); const accepted = (await s.runtime.service.get('user-1', job.id)).dispatch!;
    expect(accepted.id).not.toBe(refused.id); expect(accepted.executionRef).toBe(execution); expect(accepted.terminal).not.toBe(true);
    expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(failure === 'authorization' ? 1 : 2);
    expect(reserve).toHaveBeenCalledTimes(1); expect(s.finance.refunds).toBe(0); expect(s.finance.settlements).toBe(0);
    await s.runtime.close();
  });
  it('retains the current generation when authorization fails while monitoring an accepted execution', async () => {
    const execution = 'projects/demo-project/locations/asia-east1/jobs/watermark-worker/executions/accepted';
    const getAccessToken = vi.fn(async () => 'private-test-token');
    const request = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST' ? Response.json({ metadata: { name: execution } }) : Response.json({ name: execution, runningCount: 1 }));
    const trigger = createCloudRunTrigger({ projectId: 'demo-project', region: 'asia-east1', jobName: 'watermark-worker', fetchImpl: request as typeof fetch, getAccessToken, now: () => new Date(NOW) });
    const s = await setup({ trigger }); const job = await queueProcessing(s); await s.runtime.dispatch();
    const accepted = (await s.runtime.service.get('user-1', job.id)).dispatch!;
    getAccessToken.mockRejectedValue(new CloudRunTriggerError('private credential failure', 'authorization', 'google_sts', 403));
    await s.runtime.dispatch(); await s.runtime.dispatch();
    expect((await s.runtime.service.get('user-1', job.id)).dispatch).toEqual(accepted);
    expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1); expect(s.finance.refunds).toBe(0);
    await s.runtime.close();
  });
  it.each(['network', '408', '503', 'malformed'] as const)('keeps an ambiguous %s run on the same nonce with GET-only recovery', async (failure) => {
    const request = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== 'POST') return Response.json({ executions: [] });
      if (failure === 'network') throw new Error('run acknowledgement lost');
      if (failure === 'malformed') return Response.json({});
      return new Response('private uncertain response', { status: Number(failure) });
    });
    const trigger = createCloudRunTrigger({ projectId: 'demo-project', region: 'asia-east1', jobName: 'watermark-worker', fetchImpl: request as typeof fetch, getAccessToken: async () => 'private-test-token', now: () => new Date(NOW) });
    const s = await setup({ trigger }); const job = await queueProcessing(s); await s.runtime.dispatch();
    const uncertain = (await s.runtime.service.get('user-1', job.id)).dispatch!;
    expect(uncertain.executionRef).toBe(`uncertain:${uncertain.id}`); expect(uncertain.terminal).not.toBe(true);
    await s.runtime.dispatch(); expect((await s.runtime.service.get('user-1', job.id)).dispatch).toEqual(uncertain);
    expect(request.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'GET']); expect(s.finance.refunds).toBe(0);
    await s.runtime.close();
  });
  it('journals an accepted execution before acknowledging the outbox and monitors it after an acknowledgement crash', async () => {
    let starts = 0;
    const trigger = vi.fn<ExecutionTrigger>(async (_action, jobId, _owner, executionRef, dispatchId) => {
      const persisted = await s.runtime.service.get('user-1', jobId);
      expect(persisted.dispatch?.id).toBe(dispatchId); expect(dispatchId).toEqual(expect.any(String));
      if (!executionRef) { starts++; expect(persisted.dispatch?.executionRef).toBe(`uncertain:${dispatchId}`); }
      else expect(executionRef).toBe('accepted-execution');
      return { executionRef: 'accepted-execution', nextCheckAt: NOW };
    });
    const s = await setup({ trigger }); const job = await queueProcessing(s);
    const acknowledgement = vi.spyOn(s.finance, 'recordDispatch').mockRejectedValueOnce(new Error('outbox acknowledgement lost'));
    await s.runtime.dispatch();
    expect((await s.runtime.service.get('user-1', job.id)).dispatch?.executionRef).toBe('accepted-execution');
    await s.runtime.dispatch();
    expect(starts).toBe(1); expect(trigger).toHaveBeenCalledTimes(2); expect(acknowledgement).toHaveBeenCalledTimes(2);
    expect(trigger.mock.calls[1][4]).toBe(trigger.mock.calls[0][4]); expect(s.finance.refunds).toBe(0);
  });
  it.each(['image-watermark', 'image-watermark-pro'] as const)('refunds %s once after dispatch authorization remains unavailable for fifteen minutes', async (operation) => {
    const trigger = vi.fn<ExecutionTrigger>().mockRejectedValue(new CloudRunTriggerError('private token', 'authorization', 'google_sts', 403));
    const s = await setup({ trigger }); const job = await queueProcessing(s, operation);
    await s.runtime.dispatch(); expect(trigger).toHaveBeenCalledTimes(1);
    const later = createProcessingRuntime({ ...s.config, dependencies: { ...s.config.dependencies, now: () => new Date(Date.parse(NOW) + 15 * 60_000) } });
    await later.dispatch(); await later.dispatch();
    expect(trigger).toHaveBeenCalledTimes(1); expect(s.finance.refunds).toBe(1); expect(s.finance.outbox.has(job.id)).toBe(false);
    expect(await later.service.get('user-1', job.id)).toMatchObject({ status: 'REFUNDED', chargeStatus: 'refunded', error: 'dispatch_timeout' });
    expect(await later.balances('user-1')).toEqual({ freeUses: 1, processingCredits: 100 }); await later.close();
  });
  it('expires a prior provider attempt at its twenty-four-hour deadline without dispatching or submitting another operation', async () => {
    const trigger = vi.fn<ExecutionTrigger>().mockResolvedValue({ nextCheckAt: NOW }); const s = await setup({ trigger }); const job = await queueProcessing(s);
    replaceJob(s, { ...job, status: 'UNKNOWN', attempt: { id: 'existing-attempt', startedAt: NOW }, unknownUntil: new Date(Date.parse(NOW) + 24 * 60 * 60_000).toISOString() });
    const later = createProcessingRuntime({ ...s.config, dependencies: { ...s.config.dependencies, now: () => new Date(Date.parse(NOW) + 24 * 60 * 60_000) } });
    await later.dispatch(); await later.dispatch();
    expect(trigger).not.toHaveBeenCalled(); expect(s.finance.refunds).toBe(1); expect(s.finance.settlements).toBe(0);
    expect(await later.service.get('user-1', job.id)).toMatchObject({ status: 'REFUNDED', error: 'unknown_timeout', attempt: { id: 'existing-attempt' } }); await later.close();
  });
  it('resumes a refund intent before acknowledging a terminal status and holds dispatch while its recovery lease is live', async () => {
    const trigger = vi.fn<ExecutionTrigger>().mockResolvedValue({ nextCheckAt: NOW }); const s = await setup({ trigger }); const job = await queueProcessing(s);
    replaceJob(s, { ...job, status: 'FAILED', refundIntent: { reason: 'dispatch_timeout', requestedAt: NOW } });
    const refund = vi.spyOn(s.finance, 'refund').mockRejectedValueOnce(new Error('temporary financial outage'));
    await s.runtime.dispatch(); await s.runtime.dispatch();
    expect(refund).toHaveBeenCalledTimes(1); expect(trigger).not.toHaveBeenCalled(); expect(s.finance.outbox.has(job.id)).toBe(true);
    const later = createProcessingRuntime({ ...s.config, dependencies: { ...s.config.dependencies, now: () => new Date(Date.parse(NOW) + 60_000) } });
    await later.dispatch(); await later.dispatch();
    expect(s.finance.refunds).toBe(1); expect(s.finance.outbox.has(job.id)).toBe(false); expect(trigger).not.toHaveBeenCalled(); await later.close();
  });
  it('starts a fresh execution only on the next dispatch after a terminal execution acknowledgement', async () => {
    const trigger = vi.fn<ExecutionTrigger>().mockResolvedValue({ executionRef: 'terminal-execution', terminal: true, nextCheckAt: NOW });
    const s = await setup({ trigger }); const job = await queueProcessing(s);
    await s.runtime.dispatch(); expect(trigger).toHaveBeenCalledTimes(1);
    expect((await s.runtime.service.get('user-1', job.id)).dispatch?.terminal).toBe(true);
    await s.runtime.dispatch(); expect(trigger).toHaveBeenCalledTimes(2);
    expect(trigger.mock.calls[0][3]).toBeUndefined(); expect(trigger.mock.calls[1][3]).toBeUndefined();
    expect(trigger.mock.calls[1][4]).not.toBe(trigger.mock.calls[0][4]);
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
  it('keeps watermark operations disabled without their key while background availability stays independent', async () => {
    const s = await setup(); const disabled = createProcessingRuntime({ ...s.config, providerMode: 'dewatermark', apiKey: undefined });
    expect(disabled.service.capabilities().filter(c => !['background-removal', 'object-removal'].includes(c.operation)).every((c) => !c.enabled)).toBe(true);
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
    expect(runtime.service.capabilities().map(c => c.operation)).toEqual(durableOperationIds); expect(runtime.service.capabilities().every((c) => !c.enabled)).toBe(true);
    const publicConfig = JSON.stringify(runtime.service.capabilities()); expect(publicConfig).not.toContain('server-only');
    await runtime.close();
  });
});
