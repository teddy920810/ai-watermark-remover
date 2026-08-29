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

  it('uses a full-width article header with bounded article and legal reading columns', () => {
    expect(globalCssSource).toContain('.article-header { padding-right: max(28px, calc((100vw - 1080px) / 2));');
    expect(globalCssSource).toContain('.article-body { max-width: 900px;');
    expect(globalCssSource).toMatch(/\.article-body\s*\{[^}]*overflow-x:\s*clip;/s);
    expect(globalCssSource).toContain('.legal-body { max-width: 760px;');
    expect(globalCssSource).toContain('.article-body table { width: 100%; max-width: 100%; display: block; overflow-x: auto;');
    expect(globalCssSource).toContain('.article-header h1 { font-size: clamp(2.25rem, 10vw, 2.75rem);');
  });

  it('adds an accessible article outline and related-guide rail around the reading column', () => {
    expect(blogPageSource).toContain("const tableOfContents = headings.filter(({ depth }) => depth === 2);");
    expect(blogPageSource).toContain(".filter(({ data }) => data.slug !== post.data.slug)");
    expect(blogPageSource).toContain('<div class="article-layout">');
    expect(blogPageSource).toContain('<nav class="article-sidebar-card" aria-labelledby="article-toc-heading">');
    expect(blogPageSource).toContain('href={`#${heading.slug}`}');
    expect(blogPageSource).toContain('<aside class="article-related" aria-labelledby="related-guides-heading">');
    expect(globalCssSource).toMatch(/\.article-layout\s*\{[^}]*grid-template-columns:\s*minmax\(180px, 220px\) minmax\(0, 900px\) minmax\(220px, 260px\);/s);
    expect(globalCssSource).toMatch(/\.article-sidebar-card\s*\{[^}]*position:\s*sticky;[^}]*top:\s*96px;/s);
    expect(globalCssSource).toMatch(/@media \(max-width: 1300px\)[\s\S]*?\.article-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s);
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
    expect(globalCssSource).toContain('.responsive-picture, .responsive-blog-image { display: block; }');
    expect(globalCssSource).toContain('.article-body p:has(> :is(img, picture):only-child) + p:has(> em:only-child) {');
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
