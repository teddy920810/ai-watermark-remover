import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { visibleItems } from './item-visibility';

describe('CMS item visibility', () => {
  it('keeps legacy and enabled items while omitting disabled items', () => {
    const items = [{ id: 'legacy' }, { id: 'shown', enabled: true }, { id: 'hidden', enabled: false }];

    expect(visibleItems(items).map(({ id }) => id)).toEqual(['legacy', 'shown']);
  });

  it('filters homepage and landing-page feature and FAQ rendering', () => {
    const homepageSource = readFileSync(new URL('../../pages/index.astro', import.meta.url), 'utf8');
    const landingSource = readFileSync(new URL('../../components/LandingPage.astro', import.meta.url), 'utf8');

    for (const source of [homepageSource, landingSource]) {
      expect(source).toContain('visibleItems(');
      expect(source).toContain('visibleFaqItems.length > 0');
      expect(source).toContain('mainEntity: visibleFaqItems.map');
    }
  });
});
