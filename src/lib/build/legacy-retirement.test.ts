import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { collectTargetRoutes } from '../../../scripts/build-target.mjs';
import { getServerEnv } from '../config/server-env';
import { runPublicSmoke } from '../../../scripts/production-smoke.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
describe('single current processing and deployment path', () => {
  it('publishes v1 but no longer publishes the old upload or JobService routes', () => {
    const routes = collectTargetRoutes(root, 'app').map(route => route.pattern);
    expect(routes).toContain('/api/v1/[...path]');
    for (const retired of ['/api/upload-url', '/api/jobs', '/api/jobs/[id]']) expect(routes).not.toContain(retired);
  });
  it('does not let retired Provider settings block the current pipeline', () => {
    const source = { DATABASE_URL: 'postgres://fixture.test/db', R2_ENDPOINT: 'https://fixture.test', R2_ACCESS_KEY_ID: 'fixture', R2_SECRET_ACCESS_KEY: 'fixture', WATERMARK_PROVIDER: 'retired-value', DEWATERMARK_TIMEOUT_MS: 'retired-value', MOCK_PROCESSING_DELAY_MS: 'retired-value' };
    expect(getServerEnv(source)).toMatchObject({ PROCESSING_ENABLED: false, PROCESSING_PROVIDER: 'mock' });
    expect(() => getServerEnv({ ...source, PROCESSING_ENABLED: 'true', PROCESSING_PROVIDER: 'dewatermark' })).toThrow();
  });
  it('checks anonymous upload protection on v1 without sending credentials or starting a task', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => new Response('{}', { status: String(url).includes('/api/') ? 401 : 200 }));
    await runPublicSmoke('https://example.test', fetcher);
    expect(fetcher.mock.calls[3][0]).toBe('https://example.test/api/v1/uploads');
    expect(JSON.parse(String(fetcher.mock.calls[3][1]?.body))).toMatchObject({ kind: 'image', contentType: 'image/png', byteSize: expect.any(Number) });
    expect(fetcher.mock.calls.every(([, init]) => !new Headers(init?.headers).has('Cookie'))).toBe(true);
    expect(fetcher.mock.calls.some(([url]) => /\/api\/jobs/.test(String(url)))).toBe(false);
  });
  it('does not keep build-time manifests or a downloader for historical deployed chunks', () => {
    for (const file of ['apps/app/retained-assets.json', 'apps/site/retained-assets.json', 'scripts/retain-app-assets.mjs', 'apps/gateway/vercel.json']) expect(existsSync(new URL(`../../../${file}`, import.meta.url)), file).toBe(false);
  });
  it('rejects the retired separate gateway command instead of generating another deployment topology', () => {
    const result = spawnSync(process.execPath, ['scripts/build-target.mjs', 'gateway'], { cwd: root, encoding: 'utf8', env: { ...process.env, SITE_ORIGIN: 'https://site.example.test', APP_ORIGIN: 'https://app.example.test' } });
    expect(result.status).not.toBe(0);
  });
});
