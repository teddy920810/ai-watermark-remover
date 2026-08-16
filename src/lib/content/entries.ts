interface PublishedEntry {
  data: { publishedAt: string; featured?: boolean; draft?: boolean };
}

export function sortBlogEntries<T extends PublishedEntry>(entries: readonly T[]): T[] {
  return entries
    .filter((entry) => !entry.data.draft)
    .sort((left, right) => {
      const featured = Number(Boolean(right.data.featured)) - Number(Boolean(left.data.featured));
      return featured || right.data.publishedAt.localeCompare(left.data.publishedAt);
    });
}
