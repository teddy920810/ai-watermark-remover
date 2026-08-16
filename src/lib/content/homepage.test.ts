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
    expect(parsed.hero.trustItems).toHaveLength(3);
    expect(parsed.useCases).toHaveLength(3);
    expect(parsed.process.steps).toHaveLength(3);
    expect(parsed.privacy.features).toHaveLength(3);
    expect(parsed.features.items.length).toBeGreaterThan(0);
    expect(parsed.faq.items.length).toBeGreaterThan(0);
  });

  it('exposes features with bullets, image assets, and an alt text for each item', () => {
    const { features } = homepageSchema.parse(homepage);
    for (const item of features.items) {
      expect(item.title).toBeTruthy();
      expect(item.description).toBeTruthy();
      expect(item.image).toMatch(/^\//);
      expect(item.imageAlt.length).toBeGreaterThan(0);
      expect(item.bullets.length).toBeGreaterThan(0);
      expect(item.bullets.length).toBeLessThanOrEqual(4);
    }
  });

  it('exposes FAQ entries with both a question and an answer', () => {
    const { faq } = homepageSchema.parse(homepage);
    for (const item of faq.items) {
      expect(item.question).toBeTruthy();
      expect(item.answer).toBeTruthy();
    }
  });
});
