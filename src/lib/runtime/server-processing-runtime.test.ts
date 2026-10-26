import { describe, expect, it, vi } from 'vitest';
import { createServerProcessingRuntimeAccessor, createServerProcessingHandler } from './server-processing-runtime';
import type { ProcessingRuntime } from './processing-services';

const source = { R2_ACCESS_KEY_ID: 'access', R2_SECRET_ACCESS_KEY: 'private', R2_ENDPOINT: 'https://r2.test', DATABASE_URL: 'postgres://db.test/database', BETTER_AUTH_URL: 'https://www.example.test', PROCESSING_ENABLED: 'true', PROCESSING_PROVIDER: 'mock' };
function runtime() { return { service: { capabilities: () => [{ operation: 'image-watermark', enabled: true }] }, balances: vi.fn(async () => ({ freeUses: 1, processingCredits: 0 })), beginUpload: vi.fn(async () => ({ id: 'upload' })) } as unknown as ProcessingRuntime; }
describe('server processing runtime boundary', () => {
  it('keeps legacy provider settings separate from the durable provider switch', () => {
    const factory = vi.fn(runtime);
    createServerProcessingRuntimeAccessor({ ...source, WATERMARK_PROVIDER: 'dewatermark', DEWATERMARK_API_KEY: 'private-key', DEWATERMARK_BASE_URL: 'https://legacy.test', DEWATERMARK_PREDICT_MODE: '3.0', DEWATERMARK_TIMEOUT_MS: '12000', MOCK_PROCESSING_DELAY_MS: '25' }, { factory })();
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({ providerMode: 'mock', legacyProvider: { mode: 'dewatermark', baseUrl: 'https://legacy.test', predictMode: '3.0', timeoutMs: 12000, mockDelayMs: 25 } }));
  });
  it('caches only on first use and passes server-only environment and dispatcher to the Node factory', () => {
    const factory = vi.fn(runtime); const trigger = vi.fn(); const resolveTrigger = vi.fn(() => trigger);
    const getRuntime = createServerProcessingRuntimeAccessor(source, { factory, resolveTrigger });
    expect(factory).not.toHaveBeenCalled(); expect(getRuntime()).toBe(getRuntime()); expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, providerMode: 'mock', databaseUrl: source.DATABASE_URL, r2: expect.objectContaining({ secretAccessKey: 'private' }), trigger }));
    expect(resolveTrigger).toHaveBeenCalledWith(source);
  });
  it('keeps new admissions disabled until an enabled server has a durable execution dispatcher', () => {
    const factory = vi.fn(runtime); const getRuntime = createServerProcessingRuntimeAccessor(source, { factory, resolveTrigger: () => undefined });
    getRuntime(); expect(factory).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });
  it('serves anonymous capabilities without loading session/authentication code', async () => {
    const loadSession = vi.fn(async () => { throw new Error('auth database unavailable'); });
    const handler = createServerProcessingHandler({ source, getRuntime: runtime, loadSession });
    const response = await handler(new Request('https://www.example.test/api/v1/capabilities'));
    expect(response.status).toBe(200); expect(loadSession).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain('private');
  });
  it('reports all operations disabled with real local adapters before an explicit enable, without connecting to storage', async () => {
    const getRuntime = createServerProcessingRuntimeAccessor({ ...source, PROCESSING_ENABLED: 'false' });
    const loadSession = vi.fn(async () => { throw new Error('must not load auth'); });
    const handler = createServerProcessingHandler({ source, getRuntime, loadSession });
    const response = await handler(new Request('https://www.example.test/api/v1/capabilities'));
    expect(response.status).toBe(200);
    const body = await response.json(); expect(body.operations).toHaveLength(4); expect(body.operations.every((operation: { enabled: boolean }) => !operation.enabled)).toBe(true);
    expect(loadSession).not.toHaveBeenCalled(); await getRuntime().close();
  });
  it('accepts localhost only as the explicit local HTTP origin', async () => {
    const handler = createServerProcessingHandler({ source: { ...source, BETTER_AUTH_URL: 'http://localhost:4321' }, getRuntime: runtime });
    expect((await handler(new Request('http://localhost:4321/api/v1/capabilities'))).status).toBe(200);
  });
  it('loads authentication only for private routes and enforces the configured public origin', async () => {
    const r = runtime(); const session = vi.fn(async () => ({ user: { id: 'owner' } })); const loadSession = vi.fn(async () => session);
    const handler = createServerProcessingHandler({ source, getRuntime: () => r, loadSession });
    expect((await handler(new Request('https://www.example.test/api/v1/me'))).status).toBe(200); expect(loadSession).toHaveBeenCalledTimes(1);
    const response = await handler(new Request('https://www.example.test/api/v1/uploads', { method: 'POST', headers: { Origin: 'https://foreign.test', 'Content-Type': 'application/json' }, body: '{}' }));
    expect(response.status).toBe(403); expect(r.beginUpload).not.toHaveBeenCalled();
  });
  it('initializes the existing benefits email identity for authenticated new-workspace users', async () => {
    const r = runtime();
    const session = vi.fn(async () => ({ user: { id: 'owner', email: 'Person@Example.com' } }));
    const handler = createServerProcessingHandler({ source, getRuntime: () => r, loadSession: async () => session });
    const response = await handler(new Request('https://www.example.test/api/v1/me'));
    expect(response.status).toBe(200); expect(r.balances).toHaveBeenCalledOnce(); expect(r.balances).toHaveBeenCalledWith('owner', 'Person@Example.com');
  });
  it('does not initialize benefits for upload/job polling, anonymous or cross-origin requests', async () => {
    const r = { ...runtime(), ensureAccountIdentity: vi.fn(async () => { throw new Error('Polling must not initialize an account'); }) };
    r.getUpload = vi.fn(async () => ({ id: 'upload-1', status: 'validating' }) as never);
    r.service.get = vi.fn(async () => ({ id: 'job-1' }) as never);
    r.service.list = vi.fn(async () => []);
    r.projectJob = vi.fn(async () => ({ id: 'job-1' }) as never);
    const handler = createServerProcessingHandler({ source, getRuntime: () => r, loadSession: async () => async () => ({ user: { id: 'owner', email: 'person@example.com' } }) });
    await handler(new Request('https://www.example.test/api/v1/capabilities'));
    await handler(new Request('https://www.example.test/api/v1/uploads', { method: 'POST', headers: { Origin: 'https://foreign.test' } }));
    for (const path of ['uploads/upload-1', 'jobs/job-1', 'jobs']) {
      expect((await handler(new Request(`https://www.example.test/api/v1/${path}`))).status).toBe(200);
    }
    expect(r.ensureAccountIdentity).not.toHaveBeenCalled();
    expect(r.balances).not.toHaveBeenCalled();
  });
  it('rejects a path-bearing or non-HTTPS public origin without leaking environment details', async () => {
    for (const origin of ['https://www.example.test/app', 'http://www.example.test', 'https://person:private@www.example.test']) {
      const handler = createServerProcessingHandler({ source: { ...source, BETTER_AUTH_URL: origin }, getRuntime: runtime });
      const response = await handler(new Request('https://www.example.test/api/v1/capabilities'));
      expect(response.status).toBe(503); expect(await response.text()).not.toContain('private');
    }
  });
});
