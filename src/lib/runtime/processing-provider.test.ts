import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { DefinitiveProviderError, type ProcessingArtifact, type ProcessingJob, type ProcessingProviderContext } from '../processing/contracts';
import { DewatermarkClient, DewatermarkRequestError } from '../providers/dewatermark-client';
import { MockWatermarkProvider } from '../providers/mock-provider';
import { createWatermarkProvider } from '../providers/watermark-provider-factory';
import type { WatermarkProvider } from '../providers/watermark-provider';
import { mediaKey } from './private-media-store';
import { ProcessingProvider } from './processing-provider';
import { memoryMediaStore } from './test-fixtures';

const now = () => new Date('2026-10-24T00:00:00.000Z');
const resultUrl = 'https://storage.googleapis.com/vendor/result.mp4?X-Goog-Signature=private';
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}
async function fixture(operation: ProcessingJob['operation'] = 'image-watermark') {
  const memory = memoryMediaStore();
  const bytes = await sharp({ create: { width: 4, height: 2, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
  const input: ProcessingArtifact = { id: 'source-1', ownerId: 'owner-1', key: mediaKey('source', 'owner-1', 'source-1', 'image/jpeg'), role: 'source', sealed: true, sha256: createHash('sha256').update(bytes).digest('hex'), metadata: await memory.media.inspectBytes(bytes, 'image'), createdAt: now().toISOString(), expiresAt: '2026-10-25T00:00:00.000Z' };
  await memory.media.putBytes(input.key, bytes, input.metadata.contentType, { 'owner-id': input.ownerId, 'artifact-id': input.id });
  await memory.media.create(input);
  const job: ProcessingJob = { id: 'job-1', ownerId: input.ownerId, operation, status: 'SUBMITTING', quote: { id: 'quote-1', ownerId: input.ownerId, operation, inputArtifactId: input.id, amount: 1, unit: 'processingCredits', priceVersion: 'v1', fingerprint: 'fingerprint', createdAt: now().toISOString(), expiresAt: '2026-10-25T00:00:00.000Z' }, inputArtifactId: input.id, chargeStatus: 'reserved', attempt: { id: 'attempt-1', startedAt: now().toISOString() }, createdAt: now().toISOString(), updatedAt: now().toISOString() };
  const context: ProcessingProviderContext = { job, input, checkpoint: vi.fn(async (checkpoint) => { job.attempt!.checkpoint = checkpoint; }), heartbeat: vi.fn().mockResolvedValue(undefined) };
  return { ...memory, input, bytes, job, context };
}
function adapter(media: ReturnType<typeof memoryMediaStore>['media'], request: ReturnType<typeof vi.fn>): WatermarkProvider {
  return createWatermarkProvider(
    new MockWatermarkProvider({ copyObject: vi.fn().mockResolvedValue(undefined) }),
    new ProcessingProvider({ media, client: new DewatermarkClient({ apiKey: 'server-key', fetchImpl: request as typeof fetch }), now, id: () => 'result-1' }),
  );
}

describe('real processing adapter with mocked vendor transport', () => {
  it('stores and verifies the image and session without persisting unused vendor mask content', async () => {
    const state = await fixture();
    const request = vi.fn().mockResolvedValue(Response.json({ edited_image: { image: Buffer.from(state.bytes).toString('base64'), watermark_mask: 'private-watermark-bitmap', mask: 'private-mask-bitmap' }, session_id: 'session-1' }));
    const outcome = await adapter(state.media, request).submit(state.context);
    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') throw new Error('Expected completion');
    await expect(state.media.verifyStored(outcome.artifact)).resolves.toBeUndefined();
    expect(outcome.artifact).toMatchObject({ role: 'result', parentArtifactId: state.input.id, providerSessionId: 'session-1', metadata: { width: 4, height: 2, contentType: 'image/jpeg' } });
    expect(await state.media.getJson(`processing/provider-metadata/${outcome.artifact.id}.json`)).toEqual({ sessionId: 'session-1', mode: 'auto' });
    for (const key of [`processing/provider-metadata/${outcome.artifact.id}.json`, 'processing/provider-attempts/job-1/attempt-1.json', `processing/artifacts/${outcome.artifact.id}.json`]) {
      expect(JSON.stringify(await state.media.getJson(key))).not.toMatch(/private-watermark-bitmap|private-mask-bitmap|maskBase|watermark_mask/);
    }
    expect((state.context.checkpoint as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]).toBeLessThan(request.mock.invocationCallOrder[0]);
  });
  it('maps PRO to its own endpoint while retaining actual output metadata', async () => {
    const state = await fixture('image-watermark-pro');
    const request = vi.fn().mockResolvedValue(Response.json({ edited_image: { image: Buffer.from(state.bytes).toString('base64') }, session_id: 'pro-session' }));
    await adapter(state.media, request).submit(state.context);
    expect(request.mock.calls[0][0]).toContain('/v1/erase_watermark_pro');
  });
  it('delivers JPEG on white without changing provider dimensions or refinement coordinates', async () => {
    const state = await fixture();
    const png = await sharp({ create: { width: 4, height: 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const request = vi.fn().mockResolvedValue(Response.json({ edited_image: { image: png.toString('base64'), watermark_mask: 'bWFzaw==' }, session_id: 'session-1' }));
    const outcome = await adapter(state.media, request).submit(state.context);
    expect(outcome).toMatchObject({ status: 'completed', artifact: { metadata: { contentType: 'image/jpeg', width: 4, height: 2 }, providerSessionId: 'session-1' } });
    if (outcome.status !== 'completed') throw new Error('Expected completion');
    const stored = await state.media.getBytes(outcome.artifact.key);
    expect(await sharp(stored).metadata()).toMatchObject({ format: 'jpeg', width: 4, height: 2, hasAlpha: false });
    expect([...(await sharp(stored).raw().toBuffer()).subarray(0, 3)]).toEqual([255, 255, 255]);
    expect(await state.media.getJson(`processing/provider-metadata/${outcome.artifact.id}.json`)).toEqual({ sessionId: 'session-1', mode: 'auto' });
  });
  it('uses the current result JPEG and parent session with a verified same-size mask, omitting the uncertain base mask', async () => {
    const state = await fixture('image-refine');
    state.input.role = 'result'; state.input.providerSessionId = 'old-session'; state.input.key = mediaKey('result', state.input.ownerId, state.input.id, 'image/jpeg');
    state.objects.delete('processing/artifacts/source-1.json');
    await state.media.putBytes(state.input.key, state.bytes, 'image/jpeg', { 'owner-id': state.input.ownerId, 'artifact-id': state.input.id });
    await state.media.create(state.input);
    await state.media.putJson('processing/provider-metadata/source-1.json', { sessionId: 'old-session', maskBase: 'b2xkLW1hc2s=', mode: 'auto' });
    const maskBytes = await sharp(Buffer.from([255, 0, 0, 0, 0, 0, 0, 0]), { raw: { width: 4, height: 2, channels: 1 } }).png().toBuffer();
    const mask: ProcessingArtifact = { ...state.input, id: 'mask-1', key: mediaKey('mask', 'owner-1', 'mask-1', 'image/png'), role: 'mask', providerSessionId: undefined, parentArtifactId: state.input.id, metadata: await state.media.inspectBytes(maskBytes, 'image'), sha256: createHash('sha256').update(maskBytes).digest('hex') };
    delete mask.providerSessionId;
    await state.media.putBytes(mask.key, maskBytes, 'image/png', { 'owner-id': mask.ownerId, 'artifact-id': mask.id });
    await state.media.create(mask);
    state.context.mask = mask;
    const request = vi.fn().mockResolvedValue(Response.json({ edited_image: { image: Buffer.from(state.bytes).toString('base64') }, session_id: 'new-session' }));
    const entered = deferred<void>(); const release = deferred<void>(); const read = state.media.getJson.bind(state.media);
    vi.spyOn(state.media, 'getJson').mockImplementation(async (key, maximum) => {
      if (key === 'processing/provider-metadata/source-1.json') { entered.resolve(); await release.promise; }
      return read(key, maximum);
    });
    const provider = new ProcessingProvider({ media: state.media, client: new DewatermarkClient({ apiKey: 'server-key', fetchImpl: request as typeof fetch }), now, id: () => 'result-1', heartbeatIntervalMs: 2 });
    const operation = provider.submit(state.context); await entered.promise;
    (state.context.heartbeat as ReturnType<typeof vi.fn>).mockClear();
    await new Promise((resolve) => setTimeout(resolve, 8));
    const duringMetadata = (state.context.heartbeat as ReturnType<typeof vi.fn>).mock.calls.length;
    release.resolve(); await operation;
    expect(duringMetadata).toBeGreaterThan(0);
    const form = request.mock.calls[0][1].body as FormData;
    expect(form.get('session_id')).toBe('old-session'); expect(form.get('mask_base')).toBeNull(); expect(form.has('original_preview_image')).toBe(true);
    expect(new Uint8Array(await (form.get('original_preview_image') as File).arrayBuffer())).toEqual(new Uint8Array(state.bytes));
  });
  it('fails refinement before charging when its parent is too large or has no supported session', async () => {
    const state = await fixture('image-refine');
    const request = vi.fn();
    await expect(adapter(state.media, request).submit(state.context)).rejects.toBeInstanceOf(DefinitiveProviderError);
    expect(request).not.toHaveBeenCalled();
  });
  it('keeps charged network uncertainty distinct from definite HTTP refusal', async () => {
    const state = await fixture();
    const uncertain = vi.fn().mockRejectedValue(new Error('lost response'));
    await expect(adapter(state.media, uncertain).submit(state.context)).rejects.toBeInstanceOf(DewatermarkRequestError);
    const other = await fixture();
    const refused = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    await expect(adapter(other.media, refused).submit(other.context)).rejects.toBeInstanceOf(DefinitiveProviderError);
  });
  it('recovers an already saved image receipt without making another charged call', async () => {
    const state = await fixture();
    const request = vi.fn().mockResolvedValue(Response.json({ edited_image: { image: Buffer.from(state.bytes).toString('base64') }, session_id: 'session-1' }));
    const provider = adapter(state.media, request);
    const first = await provider.submit(state.context);
    request.mockClear();
    await expect(provider.poll(state.context)).resolves.toEqual(first);
    expect(request).not.toHaveBeenCalled();
  });
  it('recovers an older large mask-bearing receipt without re-persisting its mask or making another request', async () => {
    const state = await fixture();
    const maskBase = 'x'.repeat(1_048_577);
    const request = vi.fn().mockResolvedValue(Response.json({ edited_image: { image: Buffer.from(state.bytes).toString('base64'), watermark_mask: maskBase }, session_id: 'session-1' }));
    const provider = adapter(state.media, request);
    const first = await provider.submit(state.context);
    const key = 'processing/provider-attempts/job-1/attempt-1.json';
    const legacy = await state.media.getJson<{ artifact: ProcessingArtifact; providerMetadata: Record<string, unknown> }>(key, 48 * 1024 * 1024);
    if (!legacy) throw new Error('Expected receipt');
    legacy.providerMetadata.maskBase = maskBase;
    state.objects.get(key)!.bytes = Buffer.from(JSON.stringify(legacy));
    request.mockClear();
    await expect(provider.poll(state.context)).resolves.toEqual(first);
    expect(request).not.toHaveBeenCalled();
    expect(await state.media.getJson('processing/provider-metadata/result-1.json')).toEqual({ mode: 'auto', sessionId: 'session-1' });
  });
  it('renews the lease while reading a saved private receipt before recovery begins', async () => {
    const state = await fixture();
    const request = vi.fn().mockResolvedValue(Response.json({ edited_image: { image: Buffer.from(state.bytes).toString('base64') }, session_id: 'session-1' }));
    const provider = new ProcessingProvider({ media: state.media, client: new DewatermarkClient({ apiKey: 'server-key', fetchImpl: request as typeof fetch }), now, id: () => 'result-1', heartbeatIntervalMs: 2 });
    await provider.submit(state.context); request.mockClear();
    const entered = deferred<void>(); const release = deferred<void>(); const read = state.media.getJson.bind(state.media);
    vi.spyOn(state.media, 'getJson').mockImplementationOnce(async (key, maximum) => { entered.resolve(); await release.promise; return read(key, maximum); });
    const operation = provider.poll(state.context); await entered.promise;
    (state.context.heartbeat as ReturnType<typeof vi.fn>).mockClear();
    await new Promise((resolve) => setTimeout(resolve, 8));
    const duringRead = (state.context.heartbeat as ReturnType<typeof vi.fn>).mock.calls.length;
    release.resolve(); await operation;
    expect(duringRead).toBeGreaterThan(0); expect(request).not.toHaveBeenCalled();
  });
  it('deduplicates a repeated image submit against its saved receipt rather than charging twice', async () => {
    const state = await fixture();
    const request = vi.fn().mockImplementation(async () => Response.json({ edited_image: { image: Buffer.from(state.bytes).toString('base64') } }));
    const provider = adapter(state.media, request);
    const first = await provider.submit(state.context);
    request.mockClear();
    await expect(provider.submit(state.context)).resolves.toEqual(first);
    expect(request).not.toHaveBeenCalled();
  });
  it('checkpoints a video task before upload and before billing, and never resubmits an existing task', async () => {
    const state = await fixture('video-watermark');
    state.input.metadata = { kind: 'video', contentType: 'video/mp4', byteSize: state.bytes.byteLength, width: 4, height: 2, durationSeconds: 2, fps: 24, codec: 'h264', hasAudio: false };
    vi.spyOn(state.media, 'verifyStored').mockResolvedValue(undefined);
    const request = vi.fn()
      .mockResolvedValueOnce(Response.json({ task_id: 'video-task', upload_signed_url: resultUrl }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    const provider = adapter(state.media, request);
    await expect(provider.submit(state.context)).resolves.toEqual({ status: 'processing', checkpoint: { providerJobId: 'video-task', stage: 'processing' } });
    expect((state.context.checkpoint as ReturnType<typeof vi.fn>).mock.calls.map(([value]) => value.stage)).toEqual(['upload-created', 'uploaded', 'submitting', 'processing']);
    request.mockReset().mockResolvedValue(Response.json({ task_id: 'video-task', status: 'PROCESSING', progress: 0.4 }));
    await expect(provider.submit(state.context)).resolves.toMatchObject({ status: 'processing', progress: 0.4 });
    expect(request).toHaveBeenCalledTimes(1); expect(request.mock.calls[0][1].method).toBe('GET');
  });
  it('treats only provider FAILED as definite video failure while polling errors remain recoverable', async () => {
    const state = await fixture('video-watermark');
    state.job.attempt!.checkpoint = { providerJobId: 'video-task', stage: 'processing' };
    const failed = vi.fn().mockResolvedValue(Response.json({ task_id: 'video-task', status: 'FAILED' }));
    await expect(adapter(state.media, failed).poll(state.context)).resolves.toEqual({ status: 'failed', message: 'Video processing failed' });
    const network = vi.fn().mockRejectedValue(new Error('temporary polling problem'));
    await expect(adapter(state.media, network).poll(state.context)).rejects.toBeInstanceOf(DewatermarkRequestError);
  });
  it('can definitely refuse a video upload transport failure before any charged submit', async () => {
    const state = await fixture('video-watermark');
    state.input.metadata.kind = 'video';
    vi.spyOn(state.media, 'verifyStored').mockResolvedValue(undefined);
    const request = vi.fn().mockResolvedValueOnce(Response.json({ task_id: 'video-task', upload_signed_url: resultUrl })).mockRejectedValueOnce(new Error('upload disconnected'));
    await expect(adapter(state.media, request).submit(state.context)).rejects.toBeInstanceOf(DefinitiveProviderError);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('renews the lease while obtaining the private video stream before supplier upload', async () => {
    const state = await fixture('video-watermark'); state.input.metadata.kind = 'video';
    vi.spyOn(state.media, 'verifyStored').mockResolvedValue(undefined);
    const entered = deferred<void>(); const release = deferred<void>(); const read = state.media.getReadStream.bind(state.media);
    vi.spyOn(state.media, 'getReadStream').mockImplementationOnce(async (key) => { entered.resolve(); await release.promise; return read(key); });
    const request = vi.fn().mockResolvedValueOnce(Response.json({ task_id: 'video-task', upload_signed_url: resultUrl })).mockResolvedValueOnce(new Response(null, { status: 200 })).mockResolvedValueOnce(new Response(null, { status: 202 }));
    const provider = new ProcessingProvider({ media: state.media, client: new DewatermarkClient({ apiKey: 'server-key', fetchImpl: request as typeof fetch }), now, id: () => 'result-1', heartbeatIntervalMs: 2 });
    const operation = provider.submit(state.context); await entered.promise;
    (state.context.heartbeat as ReturnType<typeof vi.fn>).mockClear();
    await new Promise((resolve) => setTimeout(resolve, 8));
    const duringRead = (state.context.heartbeat as ReturnType<typeof vi.fn>).mock.calls.length;
    release.resolve(); await expect(operation).resolves.toMatchObject({ status: 'processing' });
    expect(duringRead).toBeGreaterThan(0);
  });
  it('saves a verified completed video in private R2 and checks actual audio/duration before ready', async () => {
    const state = await fixture('video-watermark');
    const metadata = { kind: 'video' as const, contentType: 'video/mp4', byteSize: state.bytes.byteLength, width: 4, height: 2, durationSeconds: 2, fps: 24, codec: 'h264', hasAudio: true };
    state.input.metadata = metadata;
    state.job.attempt!.checkpoint = { providerJobId: 'video-task', stage: 'processing' };
    vi.spyOn(state.media, 'inspectBytes').mockImplementation(async (bytes) => ({ ...metadata, byteSize: bytes.byteLength }));
    const request = vi.fn().mockResolvedValueOnce(Response.json({ task_id: 'video-task', status: 'COMPLETED', progress: 1, download_signed_url: resultUrl })).mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'video/mp4' } }));
    const outcome = await adapter(state.media, request).poll(state.context);
    expect(outcome).toMatchObject({ status: 'completed', artifact: { metadata: { kind: 'video', contentType: 'video/mp4', byteSize: 3, hasAudio: true, durationSeconds: 2 } } });
    if (outcome.status === 'completed') await expect(state.media.verifyStored(outcome.artifact)).resolves.toBeUndefined();
  });
  it('retains a paid late image response as a receipt after a heartbeat detects lease loss', async () => {
    const state = await fixture();
    const reached = deferred<void>();
    const response = deferred<Response>();
    const request = vi.fn(async () => { reached.resolve(); return response.promise; });
    const provider = new ProcessingProvider({ media: state.media, client: new DewatermarkClient({ apiKey: 'server-key', fetchImpl: request as typeof fetch }), now, id: () => 'result-1', heartbeatIntervalMs: 2 });
    const operation = provider.submit(state.context);
    await reached.promise;
    state.context.heartbeat = vi.fn().mockRejectedValue(new Error('lease lost'));
    await new Promise((resolve) => setTimeout(resolve, 8));
    response.resolve(Response.json({ edited_image: { image: Buffer.from(state.bytes).toString('base64') } }));
    await expect(operation).resolves.toMatchObject({ status: 'completed' });
    expect(await state.media.getJson('processing/provider-attempts/job-1/attempt-1.json')).toMatchObject({ artifact: { id: 'result-1' } });
  });
  it('keeps the lease alive during slow private media verification before charging', async () => {
    const state = await fixture(); const entered = deferred<void>(); const verification = deferred<void>();
    const original = state.media.verifyStored.bind(state.media);
    vi.spyOn(state.media, 'verifyStored').mockImplementationOnce(async () => { entered.resolve(); await verification.promise; }).mockImplementation(original);
    const request = vi.fn().mockResolvedValue(Response.json({ edited_image: { image: Buffer.from(state.bytes).toString('base64') } }));
    const provider = new ProcessingProvider({ media: state.media, client: new DewatermarkClient({ apiKey: 'server-key', fetchImpl: request as typeof fetch }), now, id: () => 'result-1', heartbeatIntervalMs: 2 });
    const task = provider.submit(state.context); await entered.promise;
    await new Promise((resolve) => setTimeout(resolve, 8));
    const heartbeats = (state.context.heartbeat as ReturnType<typeof vi.fn>).mock.calls.length;
    verification.resolve(); await task;
    expect(heartbeats).toBeGreaterThan(1);
  });
  it('does not expose unvalidated vendor output as completed', async () => {
    const state = await fixture();
    const request = vi.fn().mockResolvedValue(Response.json({ edited_image: { image: Buffer.from('not an image').toString('base64') } }));
    await expect(adapter(state.media, request).submit(state.context)).rejects.toThrow();
    expect(await state.media.get('result-1')).toBeNull();
  });
});
