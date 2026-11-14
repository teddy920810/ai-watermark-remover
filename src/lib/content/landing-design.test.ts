import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';
import { resolveImagePair } from './image-pair';

const contentRoot = new URL('../../content/landing-pages/', import.meta.url);
const pages = readdirSync(contentRoot).filter(file => file.endsWith('.json')).map(file => JSON.parse(readFileSync(new URL(file, contentRoot), 'utf8')));
const previewPages = pages.filter(page => !page.draft || page.heroSamples);
const mediaInventory = JSON.parse(readFileSync(new URL('../../../docs/product/CONTENT_MEDIA_MIGRATION.json', import.meta.url), 'utf8'));
const missingOriginals = new Set(mediaInventory.items.filter((item: { classification: string }) => item.classification === 'missing-fallback').map((item: { image: string }) => item.image));

describe('independent tool landing-page previews', () => {
  it.each(previewPages.map(page => [page.slug, page] as const))('keeps usable, independently editable samples on %s', (_, page) => {
    expect(page.heroSamples).toHaveLength(3);
    expect(new Set(page.heroSamples.map((sample: { id: string }) => sample.id)).size).toBe(3);
    for (const sample of page.heroSamples) {
      expect(sample.label).toEqual(expect.any(String));
    }
    for (const visual of [...page.heroSamples, ...(page.features?.items ?? [])]) {
      const pair = resolveImagePair(visual);
      expect(visual.imageAlt.trim().length).toBeGreaterThan(0);
      expect(pair.image).toEqual(expect.any(String));
      if (pair.afterImage) expect(pair.afterImage).not.toBe(pair.image);
      for (const source of [pair.image, pair.afterImage].filter((image): image is string => Boolean(image))) {
        // The recorded missing original keeps its static fallback; both comparison sources must exist.
        expect(existsSync(new URL(`../../../public${source}`, import.meta.url)), source).toBe(Boolean(pair.afterImage) || !missingOriginals.has(source));
      }
    }
  });

  it('keeps an illustrative legacy comparison static and preserves the configured primary image', () => {
    expect(resolveImagePair({
      image: '/uploads/original.webp',
      comparison: { image: '/uploads/illustration.png', style: 'gemini', watermark: 'GEMINI' },
    })).toEqual({ image: '/uploads/original.webp' });
  });

  it('provides the four Gemini feature comparisons while preserving accurate credit and privacy claims', () => {
    const gemini = pages.find(page => page.slug === 'gemini-watermark-remover');
    expect(gemini.features.items).toHaveLength(4);
    expect(gemini.features.items.map((item: { imagePosition: string }) => item.imagePosition)).toEqual(['left', 'right', 'left', 'right']);
    const privacy = gemini.features.items[3];
    expect(privacy.heading.trim().length).toBeGreaterThan(0);
    expect(privacy.description).toMatch(/private/i);
    expect(privacy.description).toMatch(/free (?:processing balance|image uses)|processing cost/i);
    expect(privacy.description).toMatch(/24 hours/i);
    expect(privacy.description).not.toMatch(/no credits to purchase|unlimited/i);
  });

  it('preserves explicit independent image sources instead of an older comparison override', () => {
    expect(resolveImagePair({
      image: '/uploads/before.webp',
      afterImage: '/uploads/after.webp',
      comparison: { image: '/uploads/old-after.png', beforeImage: '/uploads/old-before.png', style: 'gemini', watermark: 'GEMINI' },
    })).toEqual({ image: '/uploads/before.webp', afterImage: '/uploads/after.webp' });
  });

  it('exposes page-level sample, optional After and related-content controls in CMS', () => {
    const cms = parse(readFileSync(new URL('../../../.pages.yml', import.meta.url), 'utf8'));
    const fields = cms.content.find((entry: { name: string }) => entry.name === 'landing-pages').fields;
    for (const name of ['heroSamples', 'relatedTools', 'guides']) {
      expect(fields.some((field: { name: string }) => field.name === name)).toBe(true);
    }
    expect(fields.find((field: { name: string }) => field.name === 'heroSamples').fields.some((field: { name: string }) => field.name === 'afterImage')).toBe(true);
    const featureFields = fields.find((field: { name: string }) => field.name === 'features').fields.find((field: { name: string }) => field.name === 'items').fields;
    expect(featureFields.some((field: { name: string }) => field.name === 'afterImage')).toBe(true);
  });

  it('retains each page’s publication state, processing capability and independent FAQ', () => {
    expect(pages.filter(page => !page.draft)).toHaveLength(21);
    expect(pages.find(page => page.slug === 'nano-banana-watermark-remover')).toMatchObject({ draft: false, toolKind: 'watermark-remover' });
    expect(pages.filter(page => page.statusLabel === 'Coming Soon')).toHaveLength(0);
    expect(pages.find(page => page.slug === 'video-watermark-remover')).toMatchObject({ draft: false, toolKind: 'video-watermark-remover' });
    expect(pages.find(page => page.slug === 'video-watermark-remover').statusLabel).toBeUndefined();
    expect(pages.find(page => page.slug === 'remove-background').toolKind).toBe('background-remover');
    expect(pages.find(page => page.slug === 'remove-object').toolKind).toBe('object-remover');
    expect(pages.every(page => page.process.steps.length === 3 && page.faq.items.length > 0)).toBe(true);
  });
});

describe('landing design schema', () => {
  it('retains operator-supplied card copy and links instead of substituting shared titles', async () => {
    const { landingDesignFields } = await import('./landing-design');
    const section = {
      eyebrow: 'Helpful guides', heading: 'Selected guides', intro: 'Read more',
      items: [{ title: 'Operator guide title', description: 'Operator description', href: 'https://www.watermarkgemini.com/blog/best-ai-watermark-remover' }],
    };
    const parsed = z.object(landingDesignFields).parse({ relatedTools: section, guides: section });
    expect(parsed.relatedTools).toMatchObject(section);
    expect(parsed.guides).toMatchObject(section);
    const cms = parse(readFileSync(new URL('../../../.pages.yml', import.meta.url), 'utf8'));
    expect(cms.components['landing-related-content'].fields.find((field: { name: string }) => field.name === 'items')).toBeDefined();
  });

  it('accepts legacy records and preserves optional page-specific content', async () => {
    const { landingDesignFields } = await import('./landing-design');
    const schema = z.object(landingDesignFields);
    expect(schema.parse({})).toEqual({});
    const customized = {
      heroSamples: [{ id: 'product', label: 'Product', image: '/uploads/product.webp', imageAlt: 'Product photo', comparison: { beforeImage: '/uploads/product-before.webp' } }],
      relatedTools: { enabled: false, eyebrow: 'Explore', heading: 'More tools', intro: 'Choose a tool', slugs: ['remove-background'] },
      guides: { eyebrow: 'Learn', heading: 'Guides', intro: 'Helpful articles', slugs: ['my-guide'] },
    };
    expect(schema.parse(customized)).toMatchObject(customized);
    expect(schema.parse(customized).guides?.enabled).toBe(true);
  });

  it('rejects ambiguous sample identifiers and incomplete comparisons', async () => {
    const { landingDesignFields, landingComparisonSchema } = await import('./landing-design');
    const sample = { id: 'same', label: 'Photo', image: '/uploads/photo.webp', imageAlt: 'Photo' };
    expect(z.object(landingDesignFields).safeParse({ heroSamples: [sample, sample] }).success).toBe(false);
    expect(landingComparisonSchema.safeParse({}).success).toBe(false);
    expect(landingComparisonSchema.safeParse({ image: '/uploads/after.webp' }).success).toBe(false);
    expect(landingComparisonSchema.safeParse({ style: 'unknown' }).success).toBe(false);
    expect(landingComparisonSchema.parse({ style: 'gemini', watermark: 'GEMINI' })).toEqual({ style: 'gemini', watermark: 'GEMINI' });
  });

  it('retains a feature-specific clean comparison image without requiring the original artwork to change', async () => {
    const { landingComparisonSchema } = await import('./landing-design');
    const customized = { image: '/uploads/clean-feature.webp', style: 'gemini' as const, watermark: 'GEMINI' };
    expect(landingComparisonSchema.parse(customized)).toEqual(customized);
    const cms = parse(readFileSync(new URL('../../../.pages.yml', import.meta.url), 'utf8'));
    expect(cms.components['landing-comparison']).toBeUndefined();
  });

  it('restores automatic related content when CMS slug lists are cleared', async () => {
    const { landingDesignFields } = await import('./landing-design');
    const schema = z.object(landingDesignFields);
    const section = { eyebrow: 'Explore', heading: 'More content', intro: 'Choose a page' };
    const parsed = schema.parse({ relatedTools: { ...section, slugs: [] }, guides: { ...section, slugs: [] } });
    expect(parsed.relatedTools?.slugs).toBeUndefined();
    expect(parsed.guides?.slugs).toBeUndefined();
    const ordered = ['remove-object', 'remove-background'];
    expect(schema.parse({ relatedTools: { ...section, slugs: ordered } }).relatedTools?.slugs).toEqual(ordered);
    expect(schema.safeParse({ guides: { ...section, slugs: ['/blog/invalid-path'] } }).success).toBe(false);
  });
});

describe('available related tool entries', () => {
  const entries = [
    { data: { slug: 'remove-background', draft: false }, title: 'Background remover' },
    { data: { slug: 'video-watermark-remover', draft: false, statusLabel: 'Coming Soon' }, title: 'Video preview' },
    { data: { slug: 'draft-tool', draft: true }, title: 'Draft tool' },
    { data: { slug: 'remove-object', draft: false }, title: 'Object remover' },
  ];

  it('omits drafts and unavailable tools from the automatic list', async () => {
    const { availableRelatedToolEntries } = await import('./landing-design');
    expect(availableRelatedToolEntries(entries).map(entry => entry.data.slug)).toEqual(['remove-background', 'remove-object']);
  });

  it('honors CMS order while omitting drafts, Coming Soon and nonexistent slugs', async () => {
    const { availableRelatedToolEntries } = await import('./landing-design');
    const slugs = ['remove-object', 'video-watermark-remover', 'missing-tool', 'draft-tool', 'remove-background'];
    expect(availableRelatedToolEntries(entries, slugs).map(entry => entry.data.slug)).toEqual(['remove-object', 'remove-background']);
    expect(entries.map(entry => entry.data.slug)).toEqual(['remove-background', 'video-watermark-remover', 'draft-tool', 'remove-object']);
  });
});
