interface BlogSitemapSource {
  slug: string;
  publishedAt: string;
  draft?: boolean;
}

interface LandingSitemapSource {
  slug: string;
}

export interface SitemapEntry {
  path: string;
  lastmod?: string;
}

const fixedEntries: SitemapEntry[] = [
  { path: '/' },
  { path: '/blog/' },
  { path: '/privacy/' },
  { path: '/terms/' },
];

export function buildSitemapEntries({
  posts,
  landingPages,
}: {
  posts: BlogSitemapSource[];
  landingPages: LandingSitemapSource[];
}): SitemapEntry[] {
  return [
    ...fixedEntries,
    ...posts
      .filter((post) => !post.draft)
      .map((post) => ({ path: `/blog/${post.slug}/`, lastmod: post.publishedAt })),
    ...landingPages.map((page) => ({ path: `/${page.slug}/` })),
  ];
}

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function renderSitemapXml(site: URL, entries: SitemapEntry[]) {
  const uniqueEntries = Array.from(new Map(entries.map((entry) => [new URL(entry.path, site).toString(), entry])).entries());
  const urls = uniqueEntries.map(([url, entry]) => [
    '  <url>',
    `    <loc>${escapeXml(url)}</loc>`,
    ...(entry.lastmod ? [`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`] : []),
    '  </url>',
  ].join('\n'));

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}

