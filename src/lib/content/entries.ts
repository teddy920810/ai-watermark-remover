import { knownPageRoutes, normalizeRoute, reservedToolSlugs } from '../contracts/route-policy.mjs';

interface PublishedEntry {
  data: { publishedAt: string; featured?: boolean; draft?: boolean };
}

export function publicLandingEntries<T extends { data: { draft?: boolean } }>(entries: readonly T[]): T[] {
  return entries.filter((entry) => !entry.data.draft);
}

interface NavigationLink { label: string; href: string; badge?: string }
interface NavigationItem extends NavigationLink { children?: NavigationLink[] }
interface LandingNavigationEntry { data: { slug: string; heading: string; draft?: boolean; toolKind?: string; statusLabel?: string } }
function defaultToolGroup(kind?: string): string | undefined {
  switch (kind) {
    case 'background-remover': case 'object-remover': return 'Image Tools';
    case 'video-watermark-remover': return 'Video & Batch Tools';
    case undefined: case 'watermark-remover': return 'Watermark Removers';
    default: return undefined;
  }
}

/** Build-time public links; CMS ordering wins, runtime capabilities still decide processing. */
export function publicNavigation(items: readonly NavigationItem[], entries: readonly LandingNavigationEntry[]): NavigationItem[] {
  const tools = new Map(entries.filter(({ data }) => !data.draft
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.slug)
    && !reservedToolSlugs.has(data.slug) && defaultToolGroup(data.toolKind))
    .map(({ data }) => ['/' + data.slug, data]));
  const seen = new Set<string>();
  const publicLink = (link: NavigationLink): NavigationLink[] => {
    if (/^https?:\/\//.test(link.href) || link.href.startsWith('#')) return [{ ...link }];
    if (!link.href.startsWith('/') || link.href.startsWith('//')) return [];
    const route = normalizeRoute(link.href);
    if (knownPageRoutes.includes(route)) return [{ ...link }];
    if (!tools.has(route) || seen.has(route)) return [];
    seen.add(route);
    return [{ ...link, href: route }];
  };
  const navigation = items.flatMap((item): NavigationItem[] => {
    if (item.children && (item.children.length || !item.href)) {
      const children = item.children.flatMap(publicLink);
      return [{ ...item, children }];
    }
    return publicLink(item);
  });
  for (const [href, data] of [...tools].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    if (seen.has(href)) continue;
    const label = defaultToolGroup(data.toolKind)!;
    let group = navigation.find(item => item.label === label && item.children);
    if (!group) { group = { label, href: '', children: [] }; navigation.push(group); }
    group.children!.push({ label: data.heading, href, ...(data.statusLabel ? { badge: data.statusLabel } : {}) });
  }
  return navigation.filter(item => !item.children || item.children.length || item.href);
}

export function sortBlogEntries<T extends PublishedEntry>(entries: readonly T[]): T[] {
  return entries
    .filter((entry) => !entry.data.draft)
    .sort((left, right) => {
      const featured = Number(Boolean(right.data.featured)) - Number(Boolean(left.data.featured));
      return featured || right.data.publishedAt.localeCompare(left.data.publishedAt);
    });
}
