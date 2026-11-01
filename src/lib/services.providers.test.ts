import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { createUploadKey } from './upload/upload-key';

const mocks = vi.hoisted(() => ({
  pool: vi.fn(), background: vi.fn(), object: vi.fn(), watermark: vi.fn(),
  backgroundRemove: vi.fn(), objectRemove: vi.fn(), watermarkRemove: vi.fn(),
  benefits: { reserve: vi.fn(), consume: vi.fn(), refund: vi.fn() },
  objects: { head: vi.fn(), getBytes: vi.fn(), putBytes: vi.fn(), delete: vi.fn() },
  jobs: new Map<string, unknown>(),
}));
vi.mock('pg', () => ({ Pool: mocks.pool }));
vi.mock('./benefits/postgres-benefit-store', () => ({ PostgresBenefitStore: vi.fn(function () { return mocks.benefits; }) }));
vi.mock('./r2/r2-object-store', () => ({ R2ObjectStore: vi.fn(function () { return mocks.objects; }) }));
vi.mock('./jobs/r2-job-store', () => ({ R2JobStore: vi.fn(function () { return {
  save: async (job: { id: string }) => { mocks.jobs.set(job.id, job); },
  get: async (id: string) => mocks.jobs.get(id) ?? null,
}; }) }));
vi.mock('./providers/mock-background-provider', () => ({ MockBackgroundProvider: mocks.background }));
vi.mock('./providers/mock-object-provider', () => ({ MockObjectProvider: mocks.object }));
vi.mock('./providers/mock-provider', () => ({ MockWatermarkProvider: mocks.watermark }));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); mocks.jobs.clear();
  for (const [name, value] of Object.entries({ DATABASE_URL: 'postgres://unused.test/legacy', R2_ENDPOINT: 'https://unused.test', R2_ACCESS_KEY_ID: 'fixture', R2_SECRET_ACCESS_KEY: 'fixture', R2_BUCKET: 'fixture', WATERMARK_PROVIDER: 'mock', BACKGROUND_REMOVAL_PROVIDER: 'mock', OBJECT_REMOVAL_PROVIDER: 'mock', PAYPAL_ENABLED: 'false', PAYPAL_CREDITS_ENABLED: 'false' })) vi.stubEnv(name, value);
  vi.stubEnv('PAYPAL_CATALOG_JSON', undefined);
  mocks.pool.mockImplementation(function () { return {}; });
  mocks.background.mockImplementation(function () { return { remove: mocks.backgroundRemove }; });
  mocks.object.mockImplementation(function () { return { remove: mocks.objectRemove }; });
  mocks.watermark.mockImplementation(function () { return { remove: mocks.watermarkRemove }; });
  mocks.backgroundRemove.mockResolvedValue({ status: 'completed', resultKey: 'results/background/test.png' });
  mocks.objects.head.mockResolvedValue({ contentLength: 68, contentType: 'image/png' });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('legacy Provider consumers', () => {
  it('constructs only the operation requested and reuses that facet', async () => {
    const { getServices } = await import('./services');
    const services = getServices();
    expect(mocks.background).not.toHaveBeenCalled();
    expect(mocks.object).not.toHaveBeenCalled();
    expect(mocks.watermark).not.toHaveBeenCalled();
    const input = createUploadKey('image/png', 'owner', 'source-1');
    await services.jobs.create(input, 'owner', 'background-removal');
    await services.jobs.create(input, 'owner', 'background-removal');
    expect(mocks.background).toHaveBeenCalledOnce();
    expect(mocks.backgroundRemove).toHaveBeenCalledTimes(2);
    expect(mocks.object).not.toHaveBeenCalled(); expect(mocks.watermark).not.toHaveBeenCalled();
  });

  it.each([
    ['https://platform.dewatermark.ai', '4.0', 30_000],
    ['https://legacy-provider.test', '3.0', 12_345],
  ])('keeps the consumed legacy vendor request unchanged (%s)', async (baseUrl, predictMode, timeoutMs) => {
    // Primary contract reviewed during P6.A: https://dewatermark.ai/api-document
    vi.stubEnv('WATERMARK_PROVIDER', 'dewatermark'); vi.stubEnv('DEWATERMARK_API_KEY', 'server-only-provider-key');
    vi.stubEnv('DEWATERMARK_BASE_URL', baseUrl); vi.stubEnv('DEWATERMARK_PREDICT_MODE', predictMode); vi.stubEnv('DEWATERMARK_TIMEOUT_MS', String(timeoutMs));
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#55aaff' } }).png().toBuffer();
    mocks.objects.getBytes.mockResolvedValue(bytes);
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ edited_image: { image: bytes.toString('base64') } }));
    vi.stubGlobal('fetch', request); const timeout = vi.spyOn(AbortSignal, 'timeout');
    const { getServices } = await import('./services');
    const job = await getServices().jobs.create(createUploadKey('image/png', 'owner', 'source-1'), 'owner');
    expect(job.status).toBe('completed'); expect(request).toHaveBeenCalledTimes(1);
    const [url, init] = request.mock.calls[0];
    expect(url).toBe(`${baseUrl}/api/object_removal/v3/erase_watermark`);
    expect(init?.method).toBe('POST'); expect(init?.headers).toEqual({ 'X-API-KEY': 'server-only-provider-key' });
    expect((init!.body as FormData).get('predict_mode')).toBe(predictMode);
    expect(timeout).toHaveBeenCalledWith(timeoutMs);
    expect(mocks.object).not.toHaveBeenCalled(); expect(mocks.background).not.toHaveBeenCalled();
  });
});
