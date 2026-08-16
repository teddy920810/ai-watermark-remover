import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const config = JSON.parse(
  readFileSync(new URL('../../../vercel.json', import.meta.url), 'utf8'),
) as { redirects?: Array<{ source: string; destination: string; permanent: boolean }> };

describe('Vercel canonical URL redirects', () => {
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
      destination: '/:path*',
      permanent: true,
    });
  });
});
