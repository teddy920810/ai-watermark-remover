import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const landingPageFiles = [
  'batch-watermark-remover.json',
  'capcut-watermark-remover.json',
  'facebook-watermark-remover.json',
  'gemini-watermark-remover.json',
  'grok-watermark-remover.json',
  'instagram-watermark-remover.json',
  'kling-watermark-remover.json',
  'notebooklm-watermark-remover.json',
  'pdf-watermark-remover.json',
  'remove-background.json',
  'remove-logo-from-image.json',
  'remove-object.json',
  'remove-subtitle-from-video.json',
  'remove-text-from-image.json',
  'shutterstock-watermark-remover.json',
  'sora-watermark-remover.json',
  'tiktok-watermark-remover.json',
  'veo-watermark-remover.json',
  'video-watermark-remover.json',
];

const videoLandingPageFiles = new Set([
  'batch-watermark-remover.json',
  'capcut-watermark-remover.json',
  'facebook-watermark-remover.json',
  'instagram-watermark-remover.json',
  'kling-watermark-remover.json',
  'remove-subtitle-from-video.json',
  'sora-watermark-remover.json',
  'tiktok-watermark-remover.json',
  'veo-watermark-remover.json',
  'video-watermark-remover.json',
]);

const landingPageSource = readFileSync(new URL('../../components/LandingPage.astro', import.meta.url), 'utf8');
const globalCss = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');

const requestedKeywords = new Map([
  ['batch-watermark-remover.json', 'batch watermark remover'],
  ['capcut-watermark-remover.json', 'capcut watermark remover'],
  ['facebook-watermark-remover.json', 'facebook watermark remover'],
  ['gemini-watermark-remover.json', 'gemini watermark remover'],
  ['grok-watermark-remover.json', 'grok watermark remover'],
  ['instagram-watermark-remover.json', 'instagram watermark remover'],
  ['kling-watermark-remover.json', 'kling watermark remover'],
  ['notebooklm-watermark-remover.json', 'notebooklm watermark remover'],
  ['pdf-watermark-remover.json', 'pdf watermark remover'],
  ['remove-background.json', 'remove background'],
  ['remove-object.json', 'object remover'],
  ['remove-subtitle-from-video.json', 'remove subtitle from video'],
  ['shutterstock-watermark-remover.json', 'shutterstock watermark remover'],
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

  it('initializes /remove-background with its dedicated tool, steps, features, FAQ, and original visuals', () => {
    const page = JSON.parse(
      readFileSync(new URL('../../content/landing-pages/remove-background.json', import.meta.url), 'utf8'),
    );

    expect(page.slug).toBe('remove-background');
    expect(page.toolKind).toBe('background-remover');
    expect(page.process.steps).toHaveLength(3);
    expect(page.process.steps.every((step: { image?: string }) => step.image?.startsWith('/uploads/background-remover-'))).toBe(true);
    expect(page.features.items).toHaveLength(3);
    expect(page.features.items.every((item: { image?: string }) => item.image?.startsWith('/uploads/background-remover-'))).toBe(true);
    expect(page.faq.items.length).toBeGreaterThanOrEqual(6);
    expect(landingPageSource).toContain("page.toolKind === 'background-remover'");
    expect(landingPageSource).toContain('<BackgroundRemoverUploader');
  });

  it('initializes /remove-object with the dedicated full-width mask editor and complete content', () => {
    const page = JSON.parse(
      readFileSync(new URL('../../content/landing-pages/remove-object.json', import.meta.url), 'utf8'),
    );

    expect(page).toMatchObject({ slug: 'remove-object', toolKind: 'object-remover' });
    expect(page.process.steps).toHaveLength(3);
    expect(page.features.items).toHaveLength(3);
    expect(page.faq.items.length).toBeGreaterThanOrEqual(6);
    expect(landingPageSource).toContain("page.toolKind === 'object-remover'");
    expect(landingPageSource).toContain('<ObjectRemoverUploader');
  });

});
