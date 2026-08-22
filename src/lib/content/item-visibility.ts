export function visibleItems<T extends { enabled?: boolean }>(items: readonly T[]): T[] {
  return items.filter((item) => item.enabled !== false);
}
