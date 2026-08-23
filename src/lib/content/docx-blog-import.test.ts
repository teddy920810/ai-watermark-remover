import { describe, expect, it } from 'vitest';

import {
  assertBlogSlugAvailable,
  buildBlogDocument,
  convertHtmlToMarkdown,
  normalizeImportedMarkdown,
} from '../../../scripts/lib/docx-blog-import.mjs';

describe('DOCX blog import helpers', () => {
  it('normalizes Word headings, callouts, captions, image alt text, and source links', () => {
    const markdown = normalizeImportedMarkdown(`
# Imported title

## Method

#### Nested product step

> Rights and source quality

![](/uploads/example-figure-1.png)

***Figure 1. Diagnose the watermark before editing.***

- Official source — https://example.com/help
`);

    expect(markdown).not.toContain('# Imported title');
    expect(markdown).toContain('## Method');
    expect(markdown).toContain('### Nested product step');
    expect(markdown).toContain('> Rights and source quality');
    expect(markdown).toContain(
      '![Diagnose the watermark before editing.](/uploads/example-figure-1.png)',
    );
    expect(markdown).toContain('<https://example.com/help>');
  });

  it('builds CMS-compatible frontmatter without placing the summary in the body', () => {
    const document = buildBlogDocument({
      slug: 'how-to-remove-example-watermark',
      title: 'How to Remove Example Watermark',
      seoTitle: 'Remove Example Watermark Safely',
      description: 'A concise reviewed description.',
      publishedAt: '2026-08-23',
      readTime: '9 min read',
      markdown: '## Quick answer\n\nUse the source project first.',
    });

    expect(document).toContain('slug: how-to-remove-example-watermark');
    expect(document).toContain('seoTitle: Remove Example Watermark Safely');
    expect(document).toContain('author: WatermarkGemini Editorial Team');
    expect(document).toContain('draft: false');
    expect(document).toContain('contentMode: markdown');
    expect(document).toContain('## Quick answer');
    expect(document.split('---').at(-1)).not.toContain('A concise reviewed description.');
  });

  it('rejects a blog slug that already exists', () => {
    expect(() =>
      assertBlogSlugAvailable('existing-post', new Set(['existing-post', 'another-post'])),
    ).toThrow(/already exists/i);
  });

  it('converts Word-style callout and data tables without empty pipe artifacts', () => {
    const markdown = convertHtmlToMarkdown(`
      <table><tr><td><p><strong>Best for</strong></p><ul><li>Fixed edge mark</li></ul></td></tr></table>
      <table>
        <tr><td><p><strong>Pattern</strong></p></td><td><p><strong>Action</strong></p></td></tr>
        <tr><td><p>Fixed edge</p></td><td><p>Crop the GIF</p></td></tr>
      </table>
    `);

    expect(markdown).toContain('> **Best for**');
    expect(markdown).toContain('> - Fixed edge mark');
    expect(markdown).toContain('| **Pattern** | **Action** |');
    expect(markdown).toContain('| Fixed edge | Crop the GIF |');
    expect(markdown).not.toMatch(/^> \|$/m);
    expect(markdown).not.toMatch(/^\|\s*$/m);
  });
});
