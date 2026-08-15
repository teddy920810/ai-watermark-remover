import type { SitemapChangeFrequency, SitemapSettings } from './sitemap-settings';

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
  changefreq?: SitemapChangeFrequency;
  priority?: number;
}

function withRule(path: string, lastmod: string, rule: SitemapSettings['groups']['homepage']): SitemapEntry {
  return { path, lastmod, changefreq: rule.changefreq, priority: rule.priority };
}

export function buildSitemapEntries({
  posts,
  landingPages,
  settings,
}: {
  posts: BlogSitemapSource[];
  landingPages: LandingSitemapSource[];
  settings: SitemapSettings;
}): SitemapEntry[] {
  const entries: SitemapEntry[] = [
    withRule('/', settings.lastmod, settings.groups.homepage),
    withRule('/blog', settings.lastmod, settings.groups.blogIndex),
    withRule('/privacy', settings.lastmod, settings.groups.legalPages),
    withRule('/terms', settings.lastmod, settings.groups.legalPages),
    ...posts
      .filter((post) => !post.draft)
      .map((post) => withRule(`/blog/${post.slug}`, post.publishedAt, settings.groups.blogPosts)),
    ...landingPages.map((page) => withRule(`/${page.slug}`, settings.lastmod, settings.groups.landingPages)),
  ];

  const overrides = new Map(settings.overrides.map((override) => [override.path, override]));
  return entries.map((entry) => ({ ...entry, ...overrides.get(entry.path), path: entry.path }));
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
  const entryMap = new Map<string, SitemapEntry>();
  entries.forEach((entry) => {
    const url = new URL(entry.path, site).toString();
    if (!entryMap.has(url)) entryMap.set(url, entry);
  });
  const uniqueEntries = Array.from(entryMap.entries());
  const urls = uniqueEntries.map(([url, entry]) => [
    '  <url>',
    `    <loc>${escapeXml(url)}</loc>`,
    ...(entry.lastmod ? [`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`] : []),
    ...(entry.changefreq ? [`    <changefreq>${entry.changefreq}</changefreq>`] : []),
    ...(entry.priority !== undefined ? [`    <priority>${entry.priority.toFixed(1)}</priority>`] : []),
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

