import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const config = JSON.parse(
  readFileSync(new URL('../../../vercel.json', import.meta.url), 'utf8'),
) as { trailingSlash?: boolean; redirects?: Array<{ source: string; destination: string; permanent: boolean }> };

describe('Vercel canonical URL redirects', () => {
  it('redirects public routes to the trailing-slash form used by canonical and sitemap URLs', () => {
    expect(config.trailingSlash).toBe(true);
  });
  it('permanently redirects /index.html to the homepage', () => {
    expect(config.redirects).toContainEqual({
      source: '/index.html',
      destination: '/',
      permanent: true,
    });
  });

  it('removes nested /index.html filenames from public URLs', () => {
    expect(config.redirects).toContainEqual({
      source: '/:path*/index.html',
      destination: '/:path*/',
      permanent: true,
    });
  });
});
