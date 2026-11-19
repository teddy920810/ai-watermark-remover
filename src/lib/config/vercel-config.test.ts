import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const config = JSON.parse(
  readFileSync(new URL('../../../vercel.json', import.meta.url), 'utf8'),
) as { trailingSlash?: boolean; redirects?: Array<{ source: string; destination: string; permanent: boolean }> };

describe('Vercel canonical URL redirects', () => {
  it('keeps clean public and API routes in the no-trailing-slash form', () => {
    expect(config.trailingSlash).toBe(false);
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
      destination: '/:path*',
      permanent: true,
    });
  });

  it('permanently redirects the former Gemini landing-page path', () => {
    expect(config.redirects).toContainEqual({
      source: '/remove-gemini-watermark',
      destination: '/gemini-watermark-remover',
      permanent: true,
    });
  });

  it('permanently redirects the former background-remover path to the only canonical route', () => {
    expect(config.redirects).toContainEqual({
      source: '/background-remover',
      destination: '/remove-background',
      permanent: true,
    });
  });
});

describe('browser caching for fingerprinted build assets', () => {
  it.each(['site', 'app'])('limits the %s immutable header to generated JS and CSS', target => {
    const deployment = JSON.parse(readFileSync(new URL(`../../../apps/${target}/vercel.json`, import.meta.url), 'utf8'));
    const immutable = deployment.headers.find((rule: { headers: { value: string }[] }) => rule.headers.some(header => /\bimmutable\b/.test(header.value)));
    const source = immutable?.source as string | undefined;
    expect(source).toBe(`/_${target}-assets/:asset([A-Za-z0-9_.-]+[.][A-Za-z0-9_-]{8}[.](?:js|css))`);
    const pattern = new RegExp(`^${source!.replace(':asset', '')}$`);
    expect(pattern.test(`/_${target}-assets/client.BJQPcj77.js`)).toBe(true);
    expect(pattern.test(`/_${target}-assets/Stage.Z7o2_YG-.css`)).toBe(true);
    for (const path of ['/app/free/tiktok', '/api/v1/jobs', `/_${target}-assets/public/image.png`, `/_${target}-assets/client.js`, `/_${target}-assets/client.BJQPcj77.png`]) {
      expect(pattern.test(path)).toBe(false);
    }
  });
});
