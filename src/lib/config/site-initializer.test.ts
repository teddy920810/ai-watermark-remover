import { describe, expect, it } from 'vitest';
import { buildSiteInitializationPlan, parseSiteInitConfig } from '../../../scripts/site-initializer.mjs';

const config = {
  packageName: 'example-image-tool',
  siteName: 'Example Image Tool',
  siteUrl: 'https://www.example.com',
  locale: 'en',
  themeColor: '#ffffff',
  logo: '/uploads/example-logo.svg',
  favicon: '/uploads/example-logo.svg',
  defaultShareImage: '/uploads/example-share.webp',
  defaultTitle: 'Example image tool',
  defaultDescription: 'A clear description for a new image tool website.',
  googleMeasurementId: '',
  defaultAuthor: 'Example Editorial Team',
  defaultCategory: 'Guides',
};

const files = {
  'package.json': JSON.stringify({ name: 'old-name', private: true }, null, 2),
  '.env.example': 'SITE_URL=https://old.example\nR2_BUCKET=images\nBETTER_AUTH_URL=https://old.example\n',
  'src/content/settings/site.json': JSON.stringify({
    name: 'Old site',
    locale: 'en',
    themeColor: '#000000',
    logo: '/old.svg',
    favicon: '/old.svg',
    defaultShareImage: '/old.webp',
    defaultTitle: 'Old title',
    defaultDescription: 'Old description',
    analytics: { googleMeasurementId: 'G-OLD123' },
    contentDefaults: { author: 'Old author', category: 'Old category' },
    header: { navigation: [{ label: 'Keep me', href: '/' }] },
    footer: { tagline: 'Keep this content', links: [] },
  }, null, 2),
};

describe('forked-site initializer', () => {
  it('updates identity files while preserving CMS-authored navigation and footer content', () => {
    const plan = buildSiteInitializationPlan(parseSiteInitConfig(config), files);
    const site = JSON.parse(plan['src/content/settings/site.json']);
    const previousSite = JSON.parse(files['src/content/settings/site.json']);

    expect(JSON.parse(plan['package.json']).name).toBe('example-image-tool');
    expect(plan['.env.example']).toContain('SITE_URL=https://www.example.com');
    expect(plan['.env.example']).toContain('BETTER_AUTH_URL=https://www.example.com');
    expect(site.canonicalOrigin).toBe('https://www.example.com');
    expect(site).toMatchObject({
      name: 'Example Image Tool',
      logo: '/uploads/example-logo.svg',
      analytics: { googleMeasurementId: '' },
      contentDefaults: { author: 'Example Editorial Team', category: 'Guides' },
      header: previousSite.header,
      footer: previousSite.footer,
    });
  });

  it('rejects unsafe or ambiguous new-site configuration', () => {
    expect(() => parseSiteInitConfig({ ...config, siteUrl: 'http://example.com' })).toThrow();
    expect(() => parseSiteInitConfig({ ...config, packageName: 'Example Site' })).toThrow();
    expect(() => parseSiteInitConfig({ ...config, googleMeasurementId: 'UA-123' })).toThrow();
  });
});
