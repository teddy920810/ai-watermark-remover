import { describe, expect, it } from 'vitest';
import { resolveBlogMetadata } from './blog-metadata';

const defaults = { author: 'Site Editorial Team', category: 'Insights' };

describe('resolveBlogMetadata', () => {
  it('uses centralized site defaults when a post omits optional metadata', () => {
    expect(resolveBlogMetadata({ title: 'A useful guide' }, defaults, 'Example Site')).toEqual({
      title: 'A useful guide | Example Site',
      author: 'Site Editorial Team',
      category: 'Insights',
    });
  });

  it('preserves per-post author and category overrides', () => {
    expect(resolveBlogMetadata(
      { title: 'A useful guide', author: 'Guest Author', category: 'News' },
      defaults,
      'Example Site',
    )).toMatchObject({ author: 'Guest Author', category: 'News' });
  });
});
