import { describe, expect, it } from 'vitest';
import { collectSiteValidationIssues, collectSiteValidationWarnings } from '../../../scripts/site-validator.mjs';

const validInput = {
  envExample: 'SITE_URL=https://www.example.com\nBETTER_AUTH_URL=https://www.example.com\n',
  canonicalOrigin: 'https://www.example.com',
  contentDocuments: [
    {
      path: 'src/content/settings/site.json',
      value: {
        logo: '/uploads/logo.svg',
        defaultShareImage: '/uploads/share.webp',
        header: { navigation: [{ href: '/blog' }] },
      },
    },
  ],
  landingSlugs: ['remove-background'],
  blogSlugs: ['first-guide'],
  availableAssets: ['/uploads/logo.svg', '/uploads/share.webp'],
};

describe('site content validation', () => {
  it('accepts a coherent forked-site configuration', () => {
    expect(collectSiteValidationIssues(validInput)).toEqual([]);
  });

  it('finds repository blob URLs, origin mismatches, and reserved routes without blocking on missing assets', () => {
    const issues = collectSiteValidationIssues({
      ...validInput,
      envExample: 'SITE_URL=https://www.example.com\nBETTER_AUTH_URL=https://example.com\n',
      canonicalOrigin: 'https://www.other-example.com',
      landingSlugs: ['blog'],
      contentDocuments: [{
        path: 'src/content/blog/broken.md',
        value: '![Missing](/uploads/missing.webp) https://github.com/acme/site/blob/main/public/uploads/file.jpg',
      }],
    });

    expect(issues).toEqual(expect.arrayContaining([
      expect.stringContaining('SITE_URL and BETTER_AUTH_URL'),
      expect.stringContaining('canonical origin'),
      expect.stringContaining('GitHub blob URL'),
      expect.stringContaining('reserved route /blog'),
    ]));
    expect(issues).not.toEqual(expect.arrayContaining([expect.stringContaining('/uploads/missing.webp')]));
  });

  it('reports missing referenced assets as non-fatal warnings', () => {
    expect(collectSiteValidationWarnings({
      ...validInput,
      contentDocuments: [{ path: 'home.json', value: { image: '/uploads/missing.webp' } }],
    })).toEqual(['home.json: referenced asset /uploads/missing.webp does not exist; the placeholder will be used.']);
  });

  it('finds broken internal links in structured content', () => {
    const issues = collectSiteValidationIssues({
      ...validInput,
      contentDocuments: [{ path: 'home.json', value: { href: '/missing-page' } }],
    });
    expect(issues).toContain('home.json: internal link /missing-page does not match a public route.');
  });
});
