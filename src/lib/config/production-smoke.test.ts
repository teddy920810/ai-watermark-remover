import { describe, expect, it, vi } from 'vitest';
import { runProductionSmoke, runPublicSmoke } from '../../../scripts/production-smoke.mjs';
function publicFetcher(failed = '') {
  return vi.fn(async (url: string | URL | Request, _init?: RequestInit) => new Response('{}', { status: String(url).endsWith(failed) && failed ? 500 : String(url).includes('/api/') ? 401 : 200 }));
}
describe('production smoke follows current processing without implicit paid work', () => {
  it('checks public pages and anonymous upload/account guards without sending credentials', async () => {
    const fetcher = publicFetcher(); await runPublicSmoke('https://example.test', fetcher);
    expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual(['/', '/robots.txt', '/sitemap.xml', '/api/v1/uploads', '/api/me/benefits', '/api/me/check-in']);
    expect(fetcher.mock.calls[3][1]?.headers).toMatchObject({ Origin: 'https://example.test', 'Content-Type': 'application/json' });
    expect(fetcher.mock.calls.every(([, init]) => !new Headers(init?.headers).has('Cookie'))).toBe(true);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2);
  });
  it.each(['/sitemap.xml', '/api/v1/uploads', '/api/me/benefits', '/api/me/check-in'])('fails when the public or anonymous boundary fails: %s', async path => {
    await expect(runPublicSmoke('https://example.test', publicFetcher(path))).rejects.toThrow();
  });
  it('keeps the scheduled/default run public even when a session exists', async () => {
    const fetcher = publicFetcher();
    await expect(runProductionSmoke({ SMOKE_BASE_URL: 'https://example.test', SMOKE_SESSION_COOKIE: 'session=fixture' }, fetcher)).resolves.toEqual({ status: 'public-passed' });
    expect(fetcher.mock.calls).toHaveLength(6);
    expect(fetcher.mock.calls.every(([, init]) => !new Headers(init?.headers).has('Cookie'))).toBe(true);
  });
});
