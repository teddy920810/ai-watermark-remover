import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { publicNavigation, sortBlogEntries } from './entries';

const tool = (slug: string, extra: Record<string, unknown> = {}) => ({ data: {
  slug, heading: `Tool ${slug}`, toolKind: 'watermark-remover', draft: false, ...extra,
} });
const menu = () => [
  { label: 'Image Tools', href: '', children: [{ label: 'Custom label', href: '/existing' }] },
  { label: 'Watermark Removers', href: '', children: [] },
  { label: 'Video & Batch Tools', href: '', children: [{ label: 'Keep Soon', href: '/soon', badge: 'Coming Soon' }] },
  { label: 'Guides', href: '/blog', children: [] },
  { label: 'Pricing', href: '/pricing', children: [] },
  { label: 'How it works', href: '/#how-it-works', children: [] },
];

describe('publicNavigation', () => {
  it('automatically includes a newly published tool without a manual navigation edit', () => {
    const result = publicNavigation(menu(), [tool('existing'), tool('soon', { statusLabel: 'Coming Soon' }), tool('new-tool')]);
    expect(result.find(item => item.label === 'Watermark Removers')?.children).toEqual([
      { label: 'Tool new-tool', href: '/new-tool' },
    ]);
    expect(result.map(item => item.label)).toEqual(menu().map(item => item.label));
  });

  it('keeps existing groups, custom labels, order and Coming Soon badges', () => {
    const navigation = menu();
    const result = publicNavigation(navigation, [tool('existing'), tool('soon', { statusLabel: 'Coming Soon' })]);
    expect(result).toEqual(navigation.filter(item => item.label !== 'Watermark Removers'));
  });

  it('omits drafts, unknown tool links and reserved or invalid tool records', () => {
    const items = [{ label: 'Tools', href: '', children: [
      { label: 'Draft', href: '/private/?preview=1#tool' },
      { label: 'Missing', href: '/missing' },
      { label: 'Reserved', href: '/api' },
      { label: 'Unknown type', href: '/unknown-kind' },
    ] }];
    expect(publicNavigation(items, [tool('private', { draft: true }), tool('api'), tool('app'), tool('pricing'), tool('../escape'), tool('unknown-kind', { toolKind: 'unknown' })])).toEqual([]);
  });

  it('normalizes and deduplicates tool links across groups and top-level items only', () => {
    const items = [
      { label: 'First', href: '', children: [{ label: 'Chosen', href: '/existing/?source=menu#tool' }] },
      { label: 'Duplicate', href: '/existing' },
      { label: 'Empty after dedup', href: '', children: [{ label: 'Again', href: '/existing/' }] },
      { label: 'How', href: '/#how-it-works' },
      { label: 'Upload', href: '/#tool' },
      { label: 'Guides', href: '/blog' },
      { label: 'Pricing', href: '/pricing' },
    ];
    expect(publicNavigation(items, [tool('existing')])).toEqual([
      { label: 'First', href: '', children: [{ label: 'Chosen', href: '/existing' }] },
      ...items.slice(3),
    ]);
  });

  it('appends missing tools in stable slug order with default groups and honest status', () => {
    const entries = [tool('z-tool'), tool('video-tool', { toolKind: 'video-watermark-remover' }), tool('a-tool'), tool('background', { toolKind: 'background-remover' }), tool('object', { toolKind: 'object-remover' }), tool('later', { statusLabel: 'Coming Soon' })];
    const result = publicNavigation(menu(), entries);
    expect(result.find(item => item.label === 'Watermark Removers')?.children).toEqual([
      { label: 'Tool a-tool', href: '/a-tool' },
      { label: 'Tool later', href: '/later', badge: 'Coming Soon' },
      { label: 'Tool z-tool', href: '/z-tool' },
    ]);
    expect(result.find(item => item.label === 'Image Tools')?.children?.map(link => link.href)).toEqual(['/background', '/object']);
    expect(result.find(item => item.label === 'Video & Batch Tools')?.children?.map(link => link.href)).toEqual(['/video-tool']);
    expect(publicNavigation(menu(), [...entries].reverse())).toEqual(result);
  });

  it('creates a default group when absent and accepts schema-defaulted legacy kinds', () => {
    expect(publicNavigation([{ label: 'Guides', href: '/blog' }], [tool('legacy', { toolKind: undefined })])).toEqual([
      { label: 'Guides', href: '/blog' },
      { label: 'Watermark Removers', href: '', children: [{ label: 'Tool legacy', href: '/legacy' }] },
    ]);
  });

  it('does not mutate the CMS navigation or landing collection', () => {
    const items = menu(); const entries = [tool('existing'), tool('new-tool')];
    const before = structuredClone({ items, entries });
    publicNavigation(items, entries);
    expect({ items, entries }).toEqual(before);
  });

  it('preserves all 20 current tools and nine Soon labels and excludes the three drafts', () => {
    const settings = JSON.parse(readFileSync('src/content/settings/site.json', 'utf8'));
    const entries = readdirSync('src/content/landing-pages').filter(file => file.endsWith('.json')).map(file => ({ data: JSON.parse(readFileSync(`src/content/landing-pages/${file}`, 'utf8')) }));
    const result = publicNavigation(settings.header.navigation, entries);
    expect(result).toEqual(settings.header.navigation);
    const links = result.flatMap(item => item.children ?? []);
    expect(links).toHaveLength(20);
    expect(links.filter(link => link.badge === 'Coming Soon')).toHaveLength(9);
    for (const entry of entries.filter(entry => entry.data.draft)) expect(links.some(link => link.href === `/${entry.data.slug}`)).toBe(false);
  });
});

describe('sortBlogEntries', () => {
  it('sorts posts by publication date from newest to oldest', () => {
    const posts = [
      { id: 'older', data: { publishedAt: '2026-07-01' } },
      { id: 'newer', data: { publishedAt: '2026-08-02' } },
    ];

    expect(sortBlogEntries(posts).map((post) => post.id)).toEqual(['newer', 'older']);
  });

  it('does not mutate the collection returned by Astro', () => {
    const posts = [
      { id: 'older', data: { publishedAt: '2026-07-01' } },
      { id: 'newer', data: { publishedAt: '2026-08-02' } },
    ];

    sortBlogEntries(posts);

    expect(posts.map((post) => post.id)).toEqual(['older', 'newer']);
  });

  it('hides drafts and places featured posts first', () => {
    const posts = [
      { id: 'newer', data: { publishedAt: '2026-08-02', featured: false, draft: false } },
      { id: 'featured', data: { publishedAt: '2026-07-01', featured: true, draft: false } },
      { id: 'draft', data: { publishedAt: '2026-08-03', featured: true, draft: true } },
    ];

    expect(sortBlogEntries(posts).map((post) => post.id)).toEqual(['featured', 'newer']);
  });
});
