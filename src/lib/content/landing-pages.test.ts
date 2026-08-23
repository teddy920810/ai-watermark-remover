import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const landingPageFiles = [
  'gemini-watermark-remover.json',
  'grok-watermark-remover.json',
  'kling-watermark-remover.json',
  'notebooklm-watermark-remover.json',
  'pdf-watermark-remover.json',
  'remove-logo-from-image.json',
  'remove-text-from-image.json',
  'sora-watermark-remover.json',
  'tiktok-watermark-remover.json',
  'veo-watermark-remover.json',
  'video-watermark-remover.json',
];

const videoLandingPageFiles = new Set([
  'kling-watermark-remover.json',
  'sora-watermark-remover.json',
  'tiktok-watermark-remover.json',
  'veo-watermark-remover.json',
  'video-watermark-remover.json',
]);

const landingPageSource = readFileSync(new URL('../../components/LandingPage.astro', import.meta.url), 'utf8');
const globalCss = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');

const requestedKeywords = new Map([
  ['gemini-watermark-remover.json', 'gemini watermark remover'],
  ['grok-watermark-remover.json', 'grok watermark remover'],
  ['kling-watermark-remover.json', 'kling watermark remover'],
  ['notebooklm-watermark-remover.json', 'notebooklm watermark remover'],
  ['pdf-watermark-remover.json', 'pdf watermark remover'],
  ['sora-watermark-remover.json', 'sora watermark remover'],
  ['tiktok-watermark-remover.json', 'tiktok watermark remover'],
  ['veo-watermark-remover.json', 'veo watermark remover'],
  ['video-watermark-remover.json', 'video watermark remover'],
]);

describe('tool landing-page usage steps', () => {
  it.each(landingPageFiles)('shows Coming Soon only on video-oriented tool page %s', (fileName) => {
    const page = JSON.parse(
      readFileSync(new URL(`../../content/landing-pages/${fileName}`, import.meta.url), 'utf8'),
    );

    expect(page.statusLabel).toBe(videoLandingPageFiles.has(fileName) ? 'Coming Soon' : undefined);
  });

  it('renders the optional status next to the landing-page eyebrow', () => {
    expect(landingPageSource).toContain('class="hero-eyebrow-row"');
    expect(landingPageSource).toContain('page.statusLabel && <span class="hero-status-badge">{page.statusLabel}</span>');
    expect(globalCss).toContain('.hero-status-badge {');
  });

  it.each(landingPageFiles)('keeps an editable three-step process in %s', (fileName) => {
    const page = JSON.parse(
      readFileSync(new URL(`../../content/landing-pages/${fileName}`, import.meta.url), 'utf8'),
    );

    expect(page.process).toMatchObject({
      eyebrow: expect.any(String),
      heading: expect.any(String),
      intro: expect.any(String),
    });
    expect(page.process.steps).toHaveLength(3);
    expect(page.process.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ number: '01', title: expect.any(String), description: expect.any(String) }),
        expect.objectContaining({ number: '02', title: expect.any(String), description: expect.any(String) }),
        expect.objectContaining({ number: '03', title: expect.any(String), description: expect.any(String) }),
      ]),
    );
  });

  it.each(landingPageFiles)('keeps an independent FAQ section in %s', (fileName) => {
    const page = JSON.parse(
      readFileSync(new URL(`../../content/landing-pages/${fileName}`, import.meta.url), 'utf8'),
    );

    expect(page.faq).toMatchObject({
      eyebrow: expect.any(String),
      heading: expect.any(String),
      intro: expect.any(String),
      items: expect.any(Array),
    });
    expect(page.faq.items.length).toBeGreaterThan(0);
  });

  it.each(landingPageFiles)('keeps every optional feature section schema-complete in %s', (fileName) => {
    const page = JSON.parse(
      readFileSync(new URL(`../../content/landing-pages/${fileName}`, import.meta.url), 'utf8'),
    );

    if (!page.features) return;

    expect(page.features).toMatchObject({
      eyebrow: expect.any(String),
      heading: expect.any(String),
      intro: expect.any(String),
      items: expect.any(Array),
    });
    expect(page.features.intro.length).toBeGreaterThan(0);
    expect(page.features.items.length).toBeGreaterThan(0);
  });

  it.each([...requestedKeywords])('targets the requested keyword in %s', (fileName, keyword) => {
    const page = JSON.parse(
      readFileSync(new URL(`../../content/landing-pages/${fileName}`, import.meta.url), 'utf8'),
    );
    const searchableCopy = [page.title, page.description, page.heading].join(' ').toLowerCase();

    expect(page.slug).toBe(fileName.replace(/\.json$/, ''));
    expect(searchableCopy).toContain(keyword);
  });

});
