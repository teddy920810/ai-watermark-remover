interface PublishedEntry {
  data: { publishedAt: string; featured?: boolean; draft?: boolean };
}

export function publicLandingEntries<T extends { data: { draft?: boolean } }>(entries: readonly T[]): T[] {
  return entries.filter((entry) => !entry.data.draft);
}

interface NavigationItem { label: string; href: string; children?: Array<{ label: string; href: string; badge?: string }> }
export function publicNavigation<T extends NavigationItem>(items: readonly T[], hiddenPaths: Set<string>): T[] {
  const visible = (href: string) => !hiddenPaths.has(href.split(/[?#]/)[0].replace(/\/$/, ''));
  return items.flatMap((item) => {
    if (item.children?.length) {
      const children = item.children.filter((child) => visible(child.href));
      return children.length ? [{ ...item, children }] : [];
    }
    return visible(item.href) ? [item] : [];
  });
}

export function sortBlogEntries<T extends PublishedEntry>(entries: readonly T[]): T[] {
  return entries
    .filter((entry) => !entry.data.draft)
    .sort((left, right) => {
      const featured = Number(Boolean(right.data.featured)) - Number(Boolean(left.data.featured));
      return featured || right.data.publishedAt.localeCompare(left.data.publishedAt);
    });
}
