import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { homepageSchema } from './homepage';

const homepage = JSON.parse(
  readFileSync(new URL('../../content/homepage/home.json', import.meta.url), 'utf8'),
);

describe('homepage CMS content', () => {
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
      expect(item.listItems.length).toBeGreaterThan(0);
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
