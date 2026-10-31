import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createBuildPlan } from '../../../scripts/build-target.mjs';

describe('private image-use purchase route', () => {
  it('keeps the purchase page in App and out of the independent SEO target', () => {
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const app = createBuildPlan(root, 'app').routes.map(route => route.pattern);
    const site = createBuildPlan(root, 'site').routes.map(route => route.pattern);
    expect(app).toContain('/app/credits');
    expect(site).not.toContain('/app/credits');
    expect([...app, ...site]).not.toContain('/pricing');
  });
});
