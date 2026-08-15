import { describe, expect, it } from 'vitest';
import { buildSitemapEntries, renderSitemapXml } from './sitemap';

describe('automatic sitemap', () => {
  it('builds public routes from fixed pages, published posts, and landing pages', () => {
    const entries = buildSitemapEntries({
      posts: [
        { slug: 'published-post', publishedAt: '2026-08-15', draft: false },
        { slug: 'draft-post', publishedAt: '2026-08-16', draft: true },
      ],
      landingPages: [{ slug: 'remove-logo' }],
    });

    expect(entries).toEqual([
      { path: '/' },
      { path: '/blog/' },
      { path: '/privacy/' },
      { path: '/terms/' },
      { path: '/blog/published-post/', lastmod: '2026-08-15' },
      { path: '/remove-logo/' },
    ]);
  });

  it('renders one sitemap.xml document with escaped, deduplicated URLs', () => {
    const xml = renderSitemapXml(new URL('https://www.example.com'), [
      { path: '/blog/' },
      { path: '/blog/' },
      { path: '/search/?topic=a&kind=b' },
    ]);

    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml.match(/<loc>https:\/\/www\.example\.com\/blog\/<\/loc>/g)).toHaveLength(1);
    expect(xml).toContain('https://www.example.com/search/?topic=a&amp;kind=b');
    expect(xml).not.toContain('<sitemapindex');
  });
});

