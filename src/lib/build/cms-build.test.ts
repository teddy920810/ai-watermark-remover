import { afterEach, describe, expect, it } from 'vitest';
import { GET } from '../../pages/cms-build.json';
import { readFileSync } from 'node:fs';
const prior = process.env.VERCEL_GIT_COMMIT_SHA;
afterEach(() => { if (prior === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA; else process.env.VERCEL_GIT_COMMIT_SHA = prior; });
describe('static Site deployment identity', () => {
  it('publishes only a validated Git revision, never arbitrary environment text', async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = 'a'.repeat(40);
    expect(await GET().json()).toEqual({ revision: 'a'.repeat(40) });
    process.env.VERCEL_GIT_COMMIT_SHA = 'not-a-revision';
    expect(await GET().json()).toEqual({ revision: null });
    expect(GET().headers.get('X-Robots-Tag')).toBe('noindex');
  });
  it('applies noindex to the static Site file through the deployment routing configuration', () => {
    const config = JSON.parse(readFileSync('apps/site/vercel.json', 'utf8'));
    expect(config.headers.find((entry: { source: string }) => entry.source === '/cms-build.json').headers).toContainEqual({ key: 'X-Robots-Tag', value: 'noindex' });
  });
});
