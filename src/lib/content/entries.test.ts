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

  it('hides drafts and places featured posts first', () => {
    const posts = [
      { id: 'newer', data: { publishedAt: '2026-08-02', featured: false, draft: false } },
      { id: 'featured', data: { publishedAt: '2026-07-01', featured: true, draft: false } },
      { id: 'draft', data: { publishedAt: '2026-08-03', featured: true, draft: true } },
    ];

    expect(sortBlogEntries(posts).map((post) => post.id)).toEqual(['featured', 'newer']);
  });
});
