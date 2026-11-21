import { describe, expect, it } from 'vitest';
import { splitInlineLinks } from './inline-links';

const origin = 'https://www.watermarkgemini.com';

describe('splitInlineLinks', () => {
  it('preserves text and order while recognizing same-site HTTPS links', () => {
    expect(splitInlineLinks('See [Pricing](/pricing) and [Privacy](https://www.watermarkgemini.com/privacy).', origin)).toEqual([
      { text: 'See ' },
      { text: 'Pricing', href: origin + '/pricing' },
      { text: ' and ' },
      { text: 'Privacy', href: origin + '/privacy' },
      { text: '.' },
    ]);
  });

  it('supports a root link when the configured origin ends with a slash', () => {
    expect(splitInlineLinks('[Home](/)', origin + '/')).toEqual([{ text: 'Home', href: origin + '/' }]);
  });

  it.each([
    'javascript:alert(1)',
    '//example.com/path',
    'https://example.com/path',
    'https://www.watermarkgemini.com@example.com/path',
    'https://user@www.watermarkgemini.com/path',
    '/\\example.com/path',
  ])('leaves an unapproved destination as literal copy: %s', destination => {
    const copy = `See [link](${destination}).`;
    expect(splitInlineLinks(copy, origin)).toEqual([{ text: copy }]);
  });
});
