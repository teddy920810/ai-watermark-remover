import { describe, expect, it } from 'vitest';
import { routePolicy, knownPageRoutes } from './route-policy.mjs';
import { collectTargetRoutes } from '../../../scripts/build-target.mjs';
import { fileURLToPath } from 'node:url';

describe('route ownership and visibility', () => {
  it('separates public Pricing ownership from private App indexing', () => {
    expect(routePolicy('/pricing')).toMatchObject({ owner: 'app', kind: 'public-page', private: false, indexable: true });
    expect(knownPageRoutes).toContain('/pricing');
    expect(routePolicy('/pricing/unknown')).toMatchObject({ owner: 'site' });
  });
  it('keeps known functional entries owned by App without treating assets as private pages', () => {
    for (const url of ['/app', '/app/image', '/app/video', '/app/credits', '/api/v1/jobs', '/auth/popup']) expect(routePolicy(url)).toMatchObject({ owner: 'app', private: true, indexable: false });
    expect(routePolicy('/_app-assets/current.js')).toMatchObject({ owner: 'app', kind: 'asset', private: false, indexable: false });
    expect(routePolicy('/blog/example')).toMatchObject({ owner: 'site', kind: 'public-page', private: false, indexable: true });
  });
  it('only registers CMS functional entry links backed by real App routes', () => {
    const routes = collectTargetRoutes(fileURLToPath(new URL('../../../', import.meta.url)), 'app').map(r => r.pattern);
    for (const route of knownPageRoutes.filter(r => r.startsWith('/app'))) expect(routes).toContain(route.replace(/\/(?:image|video)$/, '/[kind]'));
  });
});
