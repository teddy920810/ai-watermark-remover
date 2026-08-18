import { describe, expect, it } from 'vitest';
import { splitFeatureCopy } from './feature-copy';

describe('splitFeatureCopy', () => {
  it('uses explicitly configured unordered-list items', () => {
    expect(splitFeatureCopy('A normal paragraph', [' First point ', 'Second point'])).toEqual({
      description: 'A normal paragraph',
      listItems: ['First point', 'Second point'],
    });
  });

  it('converts legacy bullet-separated copy into paragraph and list items', () => {
    expect(splitFeatureCopy('Intro text • First point · Second point')).toEqual({
      description: 'Intro text',
      listItems: ['First point', 'Second point'],
    });
  });
});
