import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const blogPageSource = readFileSync(new URL('../../pages/blog/[slug].astro', import.meta.url), 'utf8');
const globalCssSource = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');
const pagesConfigSource = readFileSync(new URL('../../../.pages.yml', import.meta.url), 'utf8');
const pagesGuideSource = readFileSync(new URL('../../../docs/PAGES_CMS_GUIDE.md', import.meta.url), 'utf8');
const referenceArticleSource = readFileSync(new URL('../../content/blog/remove-moving-watermark-from-video.md', import.meta.url), 'utf8');

describe('blog article reading layout', () => {
  it('keeps the description for metadata without rendering it below the article title', () => {
    expect(blogPageSource).toContain('description={post.data.description}');
    expect(blogPageSource).not.toContain('<p>{post.data.description}</p>');
    expect(pagesConfigSource).toContain('用于搜索摘要和博客列表卡片中的普通段落，不在文章详情页标题下方显示。');
  });

  it('uses wider limits for the article header and body without widening legal pages', () => {
    expect(globalCssSource).toContain('.article-header { max-width: 1040px; }');
    expect(globalCssSource).toContain('.article-body { max-width: 900px;');
    expect(globalCssSource).toMatch(/\.article-body\s*\{[^}]*overflow-x:\s*clip;/s);
    expect(globalCssSource).toContain('.legal-body { max-width: 720px;');
    expect(globalCssSource).toContain('.article-body table { width: 100%; max-width: 100%; display: block; overflow-x: auto;');
    expect(globalCssSource).toContain('.article-header h1 { font-size: clamp(2.25rem, 10vw, 2.75rem);');
  });

  it('provides a consistent SEO article style system for CMS rich-text elements', () => {
    expect(globalCssSource).toContain('.article-body blockquote {');
    expect(globalCssSource).toContain('.article-body blockquote strong {');
    expect(globalCssSource).toContain('.article-body ul, .article-body ol {');
    expect(globalCssSource).toContain('.article-body ul { list-style: disc; }');
    expect(globalCssSource).toContain('.article-body ol { list-style: decimal; }');
    expect(globalCssSource).toContain('.article-body th {');
    expect(globalCssSource).toContain('.article-body tbody tr:nth-child(even) {');
    expect(globalCssSource).toContain('.article-body a {');
    expect(globalCssSource).toContain('.article-body pre {');
    expect(globalCssSource).toContain('.article-body p:has(> img:only-child) + p:has(> em:only-child) {');
  });

  it('lets article h3 headings inherit the neutral text color', () => {
    const h3Rule = globalCssSource.match(/\.article-body h3\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(h3Rule).not.toMatch(/\bcolor\s*:/);
  });

  it('uses real quote markup for highlighted guidance instead of visible pipe characters', () => {
    expect(referenceArticleSource).toContain('> **Official Adobe note:**');
    expect(referenceArticleSource).toContain('> **Best for**');
    expect(referenceArticleSource).not.toContain('| **Official Adobe note:**');
    expect(referenceArticleSource).not.toContain('| **Best for**');
  });

  it('documents the CMS commands used to build the supported SEO article elements', () => {
    expect(pagesConfigSource).toContain('支持段落、H2、H3、无序列表、有序列表、Quote、Table、Code block 和图片');
    expect(pagesGuideSource).toContain('输入 `/` 后可选择');
    expect(pagesGuideSource).toContain('链接不在 `/` 命令菜单中');
    expect(pagesGuideSource).toContain('[链接文字](/站内路径)');
  });
});
