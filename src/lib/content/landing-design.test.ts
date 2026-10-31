import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

const contentRoot = new URL('../../content/landing-pages/', import.meta.url);
const pages = readdirSync(contentRoot).filter(file => file.endsWith('.json')).map(file => JSON.parse(readFileSync(new URL(file, contentRoot), 'utf8')));
const previewPages = pages.filter(page => !page.draft || page.heroSamples);

describe('independent tool landing-page previews', () => {
  it.each(previewPages.map(page => [page.slug, page] as const))('keeps usable, independently editable samples on %s', (_, page) => {
    expect(page.heroSamples).toHaveLength(3);
    expect(new Set(page.heroSamples.map((sample: { id: string }) => sample.id)).size).toBe(3);
    for (const sample of page.heroSamples) {
      expect(sample.label).toEqual(expect.any(String));
      expect(sample.imageAlt).toEqual(expect.any(String));
      expect(existsSync(new URL(`../../../public${sample.image}`, import.meta.url))).toBe(true);
    }
  });

  it('uses the supplied Gemini illustrations without replacing existing feature artwork', () => {
    const gemini = pages.find(page => page.slug === 'gemini-watermark-remover');
    expect(gemini.heroSamples?.map((sample: { comparison: { style: string } }) => sample.comparison.style)).toEqual(['gemini', 'gemini', 'gemini']);
    expect(gemini.features.items.slice(0, 3).map((item: { image: string }) => item.image)).toEqual([
      '/uploads/gemini-no-crop.webp',
      '/uploads/gemini-natural-background.webp',
      '/uploads/gemini-easy-online.webp',
    ]);
  });

  it('provides the four Gemini feature comparisons while preserving accurate credit and privacy claims', () => {
    const gemini = pages.find(page => page.slug === 'gemini-watermark-remover');
    expect(gemini.features.items).toHaveLength(4);
    expect(gemini.features.items.map((item: { imagePosition: string }) => item.imagePosition)).toEqual(['left', 'right', 'left', 'right']);
    for (const feature of gemini.features.items) {
      expect(feature.comparison).toMatchObject({ image: expect.any(String), style: 'gemini', watermark: 'GEMINI' });
      expect(existsSync(new URL(`../../../public${feature.comparison.image}`, import.meta.url))).toBe(true);
    }
    const privacy = gemini.features.items[3];
    expect(privacy.heading).toBe('Free Online Watermark Removal with Private Processing');
    expect(privacy.description).toMatch(/Google/i);
    expect(privacy.description).toMatch(/daily check-in/i);
    expect(privacy.description).toMatch(/24 hours/i);
    expect(privacy.description).not.toMatch(/no credits to purchase|unlimited/i);
  });

  it('keeps existing composite artwork as a static preview', () => {
    for (const slug of ['remove-background', 'remove-object', 'remove-text-from-image']) {
      const page = pages.find(page => page.slug === slug);
      expect(page.heroSamples?.map((sample: { image: string }) => sample.image)).toEqual(page.features.items.map((item: { image: string }) => item.image));
      expect(page.heroSamples?.every((sample: { comparison?: unknown }) => !sample.comparison)).toBe(true);
    }
  });

  it('exposes page-level sample, comparison and related-content controls in CMS', () => {
    const cms = parse(readFileSync(new URL('../../../.pages.yml', import.meta.url), 'utf8'));
    const fields = cms.content.find((entry: { name: string }) => entry.name === 'landing-pages').fields;
    for (const name of ['heroSamples', 'relatedTools', 'guides']) {
      expect(fields.some((field: { name: string }) => field.name === name)).toBe(true);
    }
    expect(fields.find((field: { name: string }) => field.name === 'heroSamples').fields.some((field: { name: string }) => field.name === 'comparison')).toBe(true);
    const featureFields = fields.find((field: { name: string }) => field.name === 'features').fields.find((field: { name: string }) => field.name === 'items').fields;
    expect(featureFields.some((field: { name: string }) => field.name === 'comparison')).toBe(true);
  });

  it('retains each page’s publication state, processing capability and independent FAQ', () => {
    expect(pages.filter(page => !page.draft)).toHaveLength(20);
    expect(pages.filter(page => page.statusLabel === 'Coming Soon')).toHaveLength(9);
    expect(pages.find(page => page.slug === 'video-watermark-remover')).toMatchObject({ draft: false, toolKind: 'video-watermark-remover' });
    expect(pages.find(page => page.slug === 'video-watermark-remover').statusLabel).toBeUndefined();
    expect(pages.find(page => page.slug === 'remove-background').toolKind).toBe('background-remover');
    expect(pages.find(page => page.slug === 'remove-object').toolKind).toBe('object-remover');
    expect(pages.every(page => page.process.steps.length === 3 && page.faq.items.length > 0)).toBe(true);
  });
});

describe('landing design schema', () => {
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
    expect(cms.components['landing-comparison'].fields.some((field: { name: string }) => field.name === 'image')).toBe(true);
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
