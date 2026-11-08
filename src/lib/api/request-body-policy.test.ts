import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { boundedJson } from '../payments/http';
import { createContentApi } from '../content-api/service';
import type { ContentRepository } from '../content-api/repository';
import { createProcessingHandler, type ProcessingApiRuntime } from './processing-handler';
vi.mock('../auth', () => ({ getSession: vi.fn() }));

const origin = 'https://www.watermarkgemini.com', token = 'request-body-policy-token-for-local-tests';
const content = createContentApi({ repository: {} as ContentRepository, config: { actor: 'test', publicOrigin: origin, tokenHashes: [createHash('sha256').update(token).digest('hex')] } });
function request(target: string, body?: string | ReadableStream<Uint8Array>, headers = {}) {
  return new Request(origin + target, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': 'request-key-123', ...headers }, body, ...(body instanceof ReadableStream ? { duplex: 'half' } : {}) } as RequestInit);
}
function processing() {
  const beginUpload = vi.fn(async () => ({ id: 'upload-1' }));
  const handler = createProcessingHandler({ origin, getSession: async () => ({ user: { id: 'owner' } }), getRuntime: () => ({ beginUpload } as unknown as ProcessingApiRuntime) });
  return { handler, beginUpload };
}
describe('request body policies stay with their API owners', () => {
  it('preserves each endpoint’s content type, empty body and malformed JSON responses', async () => {
    const p = processing();
    expect((await p.handler(request('/api/v1/uploads', '{}', { 'Content-Type': 'text/plain' }))).status).toBe(400);
    expect((await p.handler(request('/api/v1/uploads'))).status).toBe(400);
    await expect(boundedJson(request('/payments'))).rejects.toMatchObject({ status: 400 });
    await expect(boundedJson(request('/payments', '{'))).rejects.toMatchObject({ status: 400 });
    expect((await content(request('/api/content/v1/changes', '{}', { 'Content-Type': 'text/plain' }))).status).toBe(415);
    expect((await content(request('/api/content/v1/changes'))).status).toBe(422);
    expect((await content(request('/api/content/v1/changes', '{'))).status).toBe(400);
  });
  it('preserves declared-length policies without trusting a short declaration', async () => {
    const p = processing();
    expect((await p.handler(request('/api/v1/uploads', '{}', { 'Content-Length': 'invalid' }))).status).toBe(413);
    expect((await content(request('/api/content/v1/changes', '{}', { 'Content-Length': '3000001' }))).status).toBe(413);
    await expect(boundedJson(request('/payments', '{}', { 'Content-Length': '999999' }))).resolves.toEqual({});
    expect(p.beginUpload).not.toHaveBeenCalled();
  });
  it('keeps BOM handling and UTF-8 decoding distinct from byte collection', async () => {
    const p = processing(), declaration = { kind: 'image', contentType: 'image/png', byteSize: 1 };
    expect((await p.handler(request('/api/v1/uploads', '\uFEFF' + JSON.stringify(declaration)))).status).toBe(201);
    await expect(boundedJson(request('/payments', '\uFEFF{}'))).rejects.toMatchObject({ status: 400 });
    expect((await content(request('/api/content/v1/changes', '\uFEFF{}'))).status).toBe(400);
    await expect(boundedJson(request('/payments', '{"text":"中文😀"}'))).resolves.toEqual({ text: '中文😀' });
  });
  it.each([['processing', 32768], ['payment', 4096], ['webhook', 262144], ['content', 3000000]] as const)('enforces the streamed %s limit even with a forged short header', async (target, limit) => {
    const cancel = vi.fn(), stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(limit + 1)); }, cancel }, { highWaterMark: 0 });
    const r = request(target === 'content' ? '/api/content/v1/changes' : '/api/v1/uploads', stream, { 'Content-Length': '1' });
    if (target === 'processing') expect((await processing().handler(r)).status).toBe(413);
    else if (target === 'content') expect((await content(r)).status).toBe(413);
    else await expect(boundedJson(r, limit)).rejects.toMatchObject({ status: 413 });
    expect(cancel).toHaveBeenCalledOnce(); expect(stream.locked).toBe(false);
  });
});
