import { existsSync, readFileSync } from 'node:fs';
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

describe('background-remover route migration', () => {
  it('keeps only /remove-background as content and internal navigation', () => {
    const canonicalPath = new URL('../../content/landing-pages/remove-background.json', import.meta.url);
    const retiredPath = new URL('../../content/landing-pages/background-remover.json', import.meta.url);
    const landingPage = JSON.parse(readFileSync(canonicalPath, 'utf8'));
    const site = readProjectFile('src/content/settings/site.json');

    expect(landingPage.slug).toBe('remove-background');
    expect(landingPage.toolKind).toBe('background-remover');
    expect(landingPage.features.items).toHaveLength(3);
    expect(landingPage.faq.items.length).toBeGreaterThanOrEqual(6);
    expect(existsSync(retiredPath)).toBe(false);
    expect(site).toContain('/remove-background');
    expect(site).not.toContain('/background-remover');
  });
});
