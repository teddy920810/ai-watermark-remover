import { describe, expect, it } from 'vitest';
import { trustedHtmlSchema } from './trusted-html';

describe('trusted CMS HTML validation', () => {
  it('accepts normal editorial HTML', () => {
    expect(trustedHtmlSchema.safeParse('<section class="callout"><h2>Tip</h2><p>Useful text.</p></section>').success)
      .toBe(true);
  });

  it.each([
    '<script>alert(1)</script>',
    '<iframe src="https://example.com"></iframe>',
    '<img src="/uploads/example.jpg" onerror="alert(1)">',
    '<a href="javascript:alert(1)">Click</a>',
  ])('rejects active HTML: %s', (html) => {
    expect(trustedHtmlSchema.safeParse(html).success).toBe(false);
  });
});
