import { describe, expect, it, vi } from 'vitest';
import { createProcessingHandler, type ProcessingApiRuntime } from './processing-handler';

function fixture() {
  const service = { capabilities: vi.fn(() => [{ operation: 'video-watermark', enabled: true }]), quote: vi.fn(async () => ({ id: 'quote-1', amount: 3, unit: 'processingCredits' })), submit: vi.fn(async () => ({ id: 'job-1' })), get: vi.fn(async () => ({ id: 'job-1', ownerId: 'owner' })), list: vi.fn(async () => []) };
  const runtime = { service, beginUpload: vi.fn(async () => ({ id: 'upload-1', uploadUrl: 'https://storage.example.test' })), completeUpload: vi.fn(async () => ({ id: 'upload-1', status: 'validating' })), getUpload: vi.fn(async () => ({ id: 'upload-1', status: 'ready' })), projectJob: vi.fn(async () => ({ id: 'job-1', status: 'READY' })), projectQuote: vi.fn(async () => ({ id: 'quote-1', amount: 3 })), balances: vi.fn(async () => ({ processingCredits: 10, freeUses: 1 })), download: vi.fn(async () => ({ url: 'https://private.example.test' })), dispatch: vi.fn(async () => {}) };
  const session = vi.fn(async () => ({ user: { id: 'owner' } }));
  const handler = createProcessingHandler({ getRuntime: () => runtime as unknown as ProcessingApiRuntime, getSession: session, origin: 'https://www.watermarkgemini.com' });
  const request = (path: string, body?: unknown, origin = 'https://www.watermarkgemini.com') => new Request(`https://www.watermarkgemini.com/api/v1/${path}`, body === undefined ? {} : { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { handler, runtime, session, request };
}

describe('processing v1 boundary', () => {
  it('stops reading and cancels an oversized streaming JSON body before another chunk', async () => {
    const f = fixture();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(32_769)); },
      pull() { throw new Error('Oversized body should already be cancelled'); },
      cancel,
    }, { highWaterMark: 0 });
    const request = new Request('https://www.watermarkgemini.com/api/v1/uploads', {
      method: 'POST', headers: { Origin: 'https://www.watermarkgemini.com', 'Content-Type': 'application/json' },
      body: stream, duplex: 'half',
    } as RequestInit);
    const response = await f.handler(request);
    expect(response.status).toBe(413);
    expect(cancel).toHaveBeenCalledOnce();
    expect(f.runtime.beginUpload).not.toHaveBeenCalled();
  });

  it('serves public capability information without accessing a session or private data', async () => {
    const f = fixture();
    f.session.mockRejectedValue(new Error('identity database offline'));
    const response = await f.handler(f.request('capabilities'));
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty('operations');
    expect(f.session).not.toHaveBeenCalled();
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex');
  });

  it('requires a session for uploads and rejects cross-origin mutations before any work', async () => {
    const f = fixture();
    f.session.mockResolvedValue(null as never);
    expect((await f.handler(f.request('uploads', { kind: 'image', contentType: 'image/jpeg', byteSize: 200 }))).status).toBe(401);
    f.session.mockResolvedValue({ user: { id: 'owner' } });
    expect((await f.handler(f.request('uploads', { kind: 'image', contentType: 'image/jpeg', byteSize: 200 }, 'https://attacker.test'))).status).toBe(403);
    expect(f.runtime.beginUpload).not.toHaveBeenCalled();
  });

  it('validates file declarations and passes the authenticated owner separately', async () => {
    const f = fixture();
    const invalid = await f.handler(f.request('uploads', { kind: 'video', contentType: 'video/mp4', byteSize: -1 }));
    expect(invalid.status).toBe(400);
    const valid = await f.handler(f.request('uploads', { kind: 'image', contentType: 'image/jpeg', byteSize: 200, ownerId: 'victim' }));
    expect(valid.status).toBe(201);
    expect(f.runtime.beginUpload).toHaveBeenCalledWith('owner', { kind: 'image', contentType: 'image/jpeg', byteSize: 200 });
  });

  it('creates an operation once through the service and does not turn a dispatch interruption into another paid submission', async () => {
    const f = fixture();
    f.runtime.dispatch.mockRejectedValue(new Error('queue unavailable'));
    const response = await f.handler(f.request('jobs', { quoteId: 'quote-1', idempotencyKey: 'client-key' }));
    expect(response.status).toBe(202);
    expect(f.runtime.service.submit).toHaveBeenCalledOnce();
    expect(f.runtime.service.submit).toHaveBeenCalledWith({ ownerId: 'owner', quoteId: 'quote-1', idempotencyKey: 'client-key' });
  });

  it('keeps task responses private and retrieves downloads by owner and task ID, never a client-supplied key', async () => {
    const f = fixture();
    const response = await f.handler(f.request('jobs/job-1/download?key=results/victim.jpg'));
    expect(response.status).toBe(200);
    expect(f.runtime.download).toHaveBeenCalledWith('owner', 'job-1');
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });

  it('does not disclose provider errors, signed URLs or server keys', async () => {
    const f = fixture();
    f.runtime.getUpload.mockRejectedValue(new Error('secret https://storage.googleapis.com/file?signature=private'));
    const response = await f.handler(f.request('uploads/upload-1'));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/secret|signature|storage.googleapis/);
  });
});
