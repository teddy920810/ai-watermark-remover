import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const configSource = readFileSync(new URL('../../content.config.ts', import.meta.url), 'utf8');
const blogPageSource = readFileSync(new URL('../../pages/blog/[slug].astro', import.meta.url), 'utf8');

describe('blog content mode', () => {
  it('models Markdown and HTML as explicit content choices', () => {
    expect(configSource).toContain("contentMode: z.enum(['markdown', 'html']).default('markdown')");
    expect(configSource).toContain('bodyHtml: trustedHtmlSchema.optional()');
    expect(configSource).toContain("post.contentMode === 'html'");
  });

  it('renders trusted HTML only when HTML mode is selected', () => {
    expect(blogPageSource).toContain("post.data.contentMode === 'html'");
    expect(blogPageSource).toContain('set:html={post.data.bodyHtml}');
    expect(blogPageSource).toContain('<Content />');
  });
});
