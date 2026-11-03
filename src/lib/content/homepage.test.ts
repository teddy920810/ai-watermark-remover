import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { homepageSchema } from './homepage';
import { parse } from 'yaml';

const homepage = JSON.parse(
  readFileSync(new URL('../../content/homepage/home.json', import.meta.url), 'utf8'),
);

describe('homepage CMS content', () => {
  it('supplies the four approved independent hero image pairs', () => {
    const parsed = homepageSchema.parse(homepage);
    const approvedSamples = [
      {
        id: 'serum', label: 'Serum',
        image: '/uploads/content-api/7e8cdeb0709d4133eb01d84d/gemini-watermark-remover-hero-03-serum-product-before-d397e6da83740ca6.webp',
        afterImage: '/uploads/content-api/7e8cdeb0709d4133eb01d84d/gemini-watermark-remover-hero-03-serum-product-after-44c2fbd00eb9ebfd.webp',
      },
      {
        id: 'sunset', label: 'Sunset',
        image: '/uploads/landing-phase2-20261103/sora-watermark-remover/hero-01-before.webp',
        afterImage: '/uploads/landing-phase2-20261103/sora-watermark-remover/hero-01-after.webp',
      },
      {
        id: 'tote', label: 'Tote bag',
        image: '/uploads/landing-phase2-20261103/remove-logo-from-image/hero-03-before.webp',
        afterImage: '/uploads/landing-phase2-20261103/remove-logo-from-image/hero-03-after.webp',
      },
      {
        id: 'contract', label: 'Contract',
        image: '/uploads/landing-phase2-20261103/pdf-watermark-remover/hero-01-before.webp',
        afterImage: '/uploads/landing-phase2-20261103/pdf-watermark-remover/hero-01-after.webp',
      },
    ];
    expect(parsed.hero.samples.map(sample => sample.afterImage)).toEqual(approvedSamples.map(sample => sample.afterImage));
    expect(parsed.hero.samples.map(({ id, label, image, afterImage }) => ({ id, label, image, afterImage }))).toEqual(approvedSamples);
    expect(parsed.hero.previewNote).toBe('Illustrative comparisons — not tested product outputs. Actual results depend on your image.');
    for (const sample of parsed.hero.samples) {
      expect(sample.afterImage).not.toBe(sample.image);
    }
  });
  it('explains the unified upload formats and separates free image uses from video credits', () => {
    const parsed = homepageSchema.parse(homepage);
    const formatAnswer = parsed.faq.items.find(item => item.question.includes('file types'))?.answer ?? '';
    const videoAnswer = parsed.faq.items.find(item => item.question.includes('video watermark'))?.answer ?? '';
    const priceAnswer = parsed.faq.items.find(item => item.question.includes('free watermark'))?.answer ?? '';
    expect(formatAnswer).toMatch(/JPG.*PNG.*WebP/i);
    expect(formatAnswer).toContain('10 MB');
    expect(formatAnswer).toContain('MP4');
    expect(formatAnswer).toContain('100 MB');
    expect(videoAnswer).toMatch(/automatically/i);
    expect(videoAnswer).toContain('24 fps');
    expect(videoAnswer).toContain('9 minutes');
    expect(videoAnswer).not.toMatch(/Video tab/);
    expect(priceAnswer).toMatch(/free.*image/i);
    expect(priceAnswer).toContain('processing credits');
    expect(parsed.hero.trustItems.join(' ')).toMatch(/image.*video/i);
    expect(parsed.hero.eyebrow).not.toMatch(/100% Free/i);
  });
  it('preserves editable comparison treatments for the new blueprint illustrations', () => {
    const customized=structuredClone(homepage);
    customized.useCases[3].comparisonStyle='date';
    customized.useCases[4].comparisonStyle='signature';
    customized.features.items[3].comparisonStyle='laptop';
    const parsed=homepageSchema.parse(customized);
    expect(parsed.useCases[3].comparisonStyle).toBe('date');
    expect(parsed.useCases[4].comparisonStyle).toBe('signature');
    expect(parsed.features.items[3].comparisonStyle).toBe('laptop');
  });
  it('uses the supplied blueprint artwork across homepage modules', () => {
    const parsed = homepageSchema.parse(homepage);
    expect(parsed.hero.samples).toHaveLength(4);
    expect(parsed.useCases).toHaveLength(5);
    expect(parsed.features.items).toHaveLength(4);
    expect(parsed.audiences.cards).toHaveLength(3);
    expect(parsed.testimonials.cards).toHaveLength(8);
    expect(parsed.removalTools.cards).toHaveLength(8);
    expect(parsed.useCases.slice(0, 3).map(item => item.image)).toEqual([
      '/uploads/home-blueprint/results/result-01-logo-hiker.png',
      '/uploads/home-blueprint/results/result-02-magazine-model.png',
      '/uploads/home-blueprint/results/result-03-gemini-water.png',
    ]);
    expect(parsed.features.items.slice(0, 3).map(item => item.image)).toEqual([
      '/uploads/home-blueprint/features/feature-01-cream-branded-base.png',
      '/uploads/home-blueprint/features/feature-02-date-base.png',
      '/uploads/home-blueprint/features/feature-03-travel-clean-base.png',
    ]);
    expect(parsed.removalTools.cards.map(item => item.image)).toEqual(["/uploads/home-blueprint/tool-cards/card-01-background-lamp.png","/uploads/home-blueprint/tool-cards/card-02-object-living-room.png","/uploads/home-blueprint/tool-cards/card-03-text-coastal-car.png","/uploads/home-blueprint/tool-cards/card-04-logo-hiking-bottle.png","/uploads/home-blueprint/tool-cards/card-05-ai-watermark-tablet.png","/uploads/home-blueprint/tool-cards/card-06-gemini-watermark-greenhouse.png","/uploads/home-blueprint/tool-cards/card-07-date-stamp-picnic.png","/uploads/home-blueprint/tool-cards/card-08-signature-architecture.png"]);
    const cms = parse(readFileSync(new URL('../../../.pages.yml', import.meta.url), 'utf8'));
    const fields = cms.content.find((entry: { name: string }) => entry.name === 'homepage').fields;
    for (const name of ['audiences', 'testimonials', 'removalTools']) expect(fields.some((field: { name: string }) => field.name === name)).toBe(true);
    expect(fields.find((field: { name: string }) => field.name === 'hero').fields.some((field: { name: string }) => field.name === 'samples')).toBe(true);
  });
  it('matches the homepage schema', () => {
    expect(homepageSchema.safeParse(homepage).success).toBe(true);
  });

  it('contains editable content for every homepage section', () => {
    const parsed = homepageSchema.parse(homepage);
    expect(parsed.hero.trustItems.length).toBeGreaterThan(0);
    expect(parsed.useCases.length).toBeGreaterThan(0);
    expect(parsed.useCaseSection.heading).toBeTruthy();
    expect(parsed.process.steps.length).toBeGreaterThan(0);
    expect(parsed.features.items.length).toBeGreaterThan(0);
    expect(parsed.faq.items.length).toBeGreaterThan(0);
    expect(parsed.privacy.features).toHaveLength(4);
    expect(parsed.useCases.every((item) => item.image && item.imageAlt)).toBe(true);
    for (const section of [parsed.process, parsed.useCaseSection, parsed.features, parsed.privacy, parsed.guides, parsed.faq]) {
      expect(section.headingHighlight).toBeTruthy();
      expect(section.heading).toContain(section.headingHighlight);
    }
  });

  it('allows each process step to override the shared CMS visual', () => {
    const customized = structuredClone(homepage);
    customized.process.steps[0].image = '/uploads/custom-step.webp';
    customized.process.steps[0].imageAlt = 'Custom upload step';

    expect(homepageSchema.parse(customized).process.steps[0]).toMatchObject({
      image: '/uploads/custom-step.webp',
      imageAlt: 'Custom upload step',
    });
  });

  it('accepts a partial homepage uploader-copy override', () => {
    const customized = structuredClone(homepage);
    customized.uploader = { hero: { heading: 'Homepage uploader heading' } };

    expect(homepageSchema.parse(customized).uploader).toEqual({
      hero: { heading: 'Homepage uploader heading' },
    });
  });

  it('contains editable feature screens with images and list items', () => {
    const parsed = homepageSchema.parse(homepage);
    expect(parsed.features).toBeDefined();
    expect(parsed.features.eyebrow).toBeTruthy();
    expect(parsed.features.heading).toBeTruthy();
    expect(parsed.features.intro).toBeTruthy();
    expect(parsed.features.items.length).toBeGreaterThan(0);
    for (const item of parsed.features.items) {
      expect(item.enabled).toBe(true);
      expect(item.eyebrow).toBeTruthy();
      expect(item.heading).toBeTruthy();
      expect(item.description).toBeTruthy();
      expect(item.image).toBeTruthy();
      expect(item.imageAlt).toBeTruthy();
      expect(Array.isArray(item.listItems)).toBe(true);
      expect(['left', 'right']).toContain(item.imagePosition);
    }
  });

  it('contains at least one FAQ entry with question and answer text', () => {
    const parsed = homepageSchema.parse(homepage);
    expect(parsed.faq).toBeDefined();
    expect(parsed.faq.eyebrow).toBeTruthy();
    expect(parsed.faq.heading).toBeTruthy();
    expect(parsed.faq.intro).toBeTruthy();
    expect(parsed.faq.items.length).toBeGreaterThan(0);
    for (const entry of parsed.faq.items) {
      expect(entry.enabled).toBe(true);
      expect(entry.question).toBeTruthy();
      expect(entry.answer).toBeTruthy();
    }
  });
});
