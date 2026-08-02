import { describe, expect, it } from 'vitest';
import { sortBlogEntries } from './entries';

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
});
