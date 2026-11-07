import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createBuildPlan } from '../../../scripts/build-target.mjs';

describe('private image-use purchase route', () => {
  it.each(['app/credits', 'pricing'])('does not describe all purchases as unavailable in unconditional %s terms', (route) => {
    const page = readFileSync(new URL(`../../pages/${route}.astro`, import.meta.url), 'utf8');
    const terms = page.slice(page.indexOf('<div class="pricing-terms">'));
    expect(terms).not.toContain('Purchases remain unavailable until checkout opens.');
  });

  it('keeps the purchase page in App and out of the independent SEO target', () => {
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const app = createBuildPlan(root, 'app').routes.map(route => route.pattern);
    const site = createBuildPlan(root, 'site').routes.map(route => route.pattern);
    expect(app).toContain('/app/credits');
    expect(site).not.toContain('/app/credits');
    expect(app).toContain('/pricing');
    expect(site).not.toContain('/pricing');
  });
});
