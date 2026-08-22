import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readProjectFile = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

describe('Gemini landing-page route migration', () => {
  it('uses the requested path in CMS content and internal navigation', () => {
    const landingPage = JSON.parse(readProjectFile('src/content/landing-pages/gemini-watermark-remover.json'));
    const site = readProjectFile('src/content/settings/site.json');
    const homepage = readProjectFile('src/content/homepage/home.json');
    const sitemap = readProjectFile('src/content/settings/sitemap.json');

    expect(landingPage.slug).toBe('gemini-watermark-remover');
    expect(site).toContain('/gemini-watermark-remover');
    expect(homepage).toContain('/gemini-watermark-remover');
    expect(sitemap).toContain('/gemini-watermark-remover');
  });
});
