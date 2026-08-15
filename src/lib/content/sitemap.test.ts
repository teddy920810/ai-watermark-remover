import { describe, expect, it } from 'vitest';
import { buildSitemapEntries, renderSitemapXml } from './sitemap';

describe('automatic sitemap', () => {
  const settings = {
    lastmod: '2026-08-15',
    groups: {
      homepage: { changefreq: 'weekly' as const, priority: 1 },
      landingPages: { changefreq: 'weekly' as const, priority: 0.8 },
      blogIndex: { changefreq: 'weekly' as const, priority: 0.7 },
      blogPosts: { changefreq: 'monthly' as const, priority: 0.6 },
      legalPages: { changefreq: 'yearly' as const, priority: 0.3 },
    },
    overrides: [{ path: '/remove-logo', priority: 0.9 }],
  };

  it('builds public routes from fixed pages, published posts, and landing pages', () => {
    const entries = buildSitemapEntries({
      posts: [
        { slug: 'published-post', publishedAt: '2026-08-15', draft: false },
        { slug: 'draft-post', publishedAt: '2026-08-16', draft: true },
      ],
      landingPages: [{ slug: 'remove-logo' }],
      settings,
    });

    expect(entries).toEqual([
      { path: '/', lastmod: '2026-08-15', changefreq: 'weekly', priority: 1 },
      { path: '/blog', lastmod: '2026-08-15', changefreq: 'weekly', priority: 0.7 },
      { path: '/privacy', lastmod: '2026-08-15', changefreq: 'yearly', priority: 0.3 },
      { path: '/terms', lastmod: '2026-08-15', changefreq: 'yearly', priority: 0.3 },
      { path: '/blog/published-post', lastmod: '2026-08-15', changefreq: 'monthly', priority: 0.6 },
      { path: '/remove-logo', lastmod: '2026-08-15', changefreq: 'weekly', priority: 0.9 },
    ]);
  });

  it('renders one sitemap.xml document with escaped, deduplicated URLs', () => {
    const xml = renderSitemapXml(new URL('https://www.example.com'), [
      { path: '/blog', lastmod: '2026-08-15', changefreq: 'weekly', priority: 1 },
      { path: '/blog' },
      { path: '/search/?topic=a&kind=b' },
    ]);

    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml.match(/<loc>https:\/\/www\.example\.com\/blog<\/loc>/g)).toHaveLength(1);
    expect(xml).toContain('https://www.example.com/search/?topic=a&amp;kind=b');
    expect(xml).toContain('<changefreq>weekly</changefreq>');
    expect(xml).toContain('<priority>1.0</priority>');
    expect(xml).not.toContain('<sitemapindex');
  });
});

