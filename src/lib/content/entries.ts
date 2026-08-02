interface PublishedEntry {
  data: { publishedAt: string };
}

export function sortBlogEntries<T extends PublishedEntry>(entries: readonly T[]): T[] {
  return [...entries].sort((left, right) => right.data.publishedAt.localeCompare(left.data.publishedAt));
}
