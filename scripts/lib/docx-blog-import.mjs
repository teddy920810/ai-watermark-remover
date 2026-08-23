import fs from 'node:fs/promises';
import path from 'node:path';
import { Buffer } from 'node:buffer';

import mammoth from 'mammoth';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import YAML from 'yaml';

const FRONTMATTER_DEFAULTS = {
  author: 'WatermarkGemini Editorial Team',
  category: 'Guide',
  featured: false,
  draft: false,
  contentMode: 'markdown',
  bodyHtml: '<p></p>',
};

const IMAGE_EXTENSIONS = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/gif', 'gif'],
  ['image/webp', 'webp'],
  ['image/svg+xml', 'svg'],
]);

const cleanInlineMarkdown = (value) =>
  value
    .replace(/<[^>]+>/g, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const quoteBlock = (value) =>
  value
    .trim()
    .split(/\r?\n/)
    .map((line) => (line.trim() ? `> ${line.trim()}` : '>'))
    .join('\n');

const normalizeListSpacing = (value) => value.replace(/^(\s*(?:>|\s)*)[-*+]\s{2,}/gm, '$1- ');

const descendantsByName = (node, name) => {
  const matches = [];
  for (const child of Array.from(node.childNodes ?? [])) {
    if (child.nodeName === name) matches.push(child);
    matches.push(...descendantsByName(child, name));
  }
  return matches;
};

export const assertBlogSlugAvailable = (slug, existingSlugs) => {
  if (existingSlugs.has(slug)) {
    throw new Error(`Blog slug already exists: ${slug}`);
  }
};

export const normalizeImportedMarkdown = (value) => {
  let markdown = value.replace(/^\s*#\s+.*(?:\r?\n){1,2}/, '');
  markdown = markdown.replace(/^#{4,}\s+/gm, '### ');
  markdown = markdown.replace(
    /!\[\]\((\/uploads\/[^)]+)\)\s*\n+\s*(\*{3}|\*{2}|\*)([^\r\n]+?)\2/g,
    (_match, imagePath, marker, caption) => {
      const cleanCaption = caption.trim();
      const alt = cleanCaption.replace(/^Figure\s+\d+\.\s*/i, '').trim();
      return `![${alt}](${imagePath})\n\n${marker}${cleanCaption}${marker}`;
    },
  );
  markdown = markdown.replace(
    /(?<![<([])https?:\/\/[^\s)>\]]+/g,
    (url) => `<${url.replace(/[.,;:]$/, '')}>${/[.,;:]$/.test(url) ? url.at(-1) : ''}`,
  );
  markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();
  return `${markdown}\n`;
};

export const buildBlogDocument = ({
  slug,
  title,
  seoTitle,
  description,
  publishedAt,
  readTime,
  markdown,
}) => {
  const frontmatter = {
    slug,
    title,
    ...(seoTitle ? { seoTitle } : {}),
    description,
    publishedAt,
    updatedAt: publishedAt,
    readTime,
    ...FRONTMATTER_DEFAULTS,
  };
  return `---\n${YAML.stringify(frontmatter).trim()}\n---\n${markdown.trim()}\n`;
};

const createTurndownService = () => {
  const service = new TurndownService({
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    headingStyle: 'atx',
    strongDelimiter: '**',
  });
  service.use(gfm);
  const cellService = new TurndownService({
    bulletListMarker: '-',
    emDelimiter: '*',
    headingStyle: 'atx',
    strongDelimiter: '**',
  });
  cellService.use(gfm);
  const renderCell = (cell, lineBreak = '<br>') =>
    normalizeListSpacing(cellService.turndown(cell.innerHTML))
      .trim()
      .replace(/\|/g, '\\|')
      .replace(/\n{2,}/g, '\n')
      .replace(/\n/g, lineBreak);
  service.addRule('word-data-table', {
    filter: (node) => node.nodeName === 'TABLE',
    replacement: (_content, node) => {
      const rows = descendantsByName(node, 'TR').map((row) =>
        Array.from(row.childNodes ?? [])
          .filter((cell) => cell.nodeName === 'TD' || cell.nodeName === 'TH')
          .map((cell) => renderCell(cell)),
      );
      const columnCount = Math.max(0, ...rows.map((row) => row.length));
      if (!columnCount) return '\n\n';
      const paddedRows = rows.map((row) => [
        ...row,
        ...Array.from({ length: columnCount - row.length }, () => ''),
      ]);
      const formatRow = (row) => `| ${row.join(' | ')} |`;
      const separator = formatRow(Array.from({ length: columnCount }, () => '---'));
      return `\n\n${formatRow(paddedRows[0])}\n${separator}\n${paddedRows
        .slice(1)
        .map(formatRow)
        .join('\n')}\n\n`;
    },
  });
  service.addRule('single-cell-callout', {
    filter: (node) =>
      node.nodeName === 'TABLE' &&
      descendantsByName(node, 'TR').length === 1 &&
      descendantsByName(node, 'TD').length + descendantsByName(node, 'TH').length === 1,
    replacement: (_content, node) => {
      const cell = descendantsByName(node, 'TD')[0] ?? descendantsByName(node, 'TH')[0];
      return `\n\n${quoteBlock(renderCell(cell, '\n'))}\n\n`;
    },
  });
  service.addRule('docx-caption', {
    filter: (node) => node.nodeName === 'P' && node.classList?.contains('docx-caption'),
    replacement: (content) => `\n\n*${content.trim()}*\n\n`,
  });
  return service;
};

export const convertHtmlToMarkdown = (html) =>
  normalizeListSpacing(createTurndownService().turndown(html));

const extractOpeningMetadata = (html, service) => {
  const h1 = html.match(/<h1>([\s\S]*?)<\/h1>/i);
  if (!h1) throw new Error('The DOCX must contain one Heading 1 title.');

  const title = cleanInlineMarkdown(service.turndown(h1[1]));
  let bodyHtml = html.slice((h1.index ?? 0) + h1[0].length);
  const firstParagraph = bodyHtml.match(/^\s*<p>([\s\S]*?)<\/p>/i);
  if (!firstParagraph) throw new Error('The DOCX must contain a summary paragraph after Heading 1.');

  const description = cleanInlineMarkdown(service.turndown(firstParagraph[1]));
  bodyHtml = bodyHtml.slice((firstParagraph.index ?? 0) + firstParagraph[0].length);
  const updatedParagraph = bodyHtml.match(/^\s*<p>([\s\S]*?)<\/p>/i);
  if (updatedParagraph && /^Updated\s/i.test(cleanInlineMarkdown(service.turndown(updatedParagraph[1])))) {
    bodyHtml = bodyHtml.slice((updatedParagraph.index ?? 0) + updatedParagraph[0].length);
  }
  return { title, description, bodyHtml };
};

const countWords = (markdown) =>
  markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[[^\]]+\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`|~-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;

export const importDocxBlog = async ({
  inputPath,
  outputDirectory,
  uploadsDirectory,
  slug,
  seoTitle,
  publishedAt,
  existingSlugs = new Set(),
}) => {
  assertBlogSlugAvailable(slug, existingSlugs);
  const images = [];
  const result = await mammoth.convertToHtml(
    { path: inputPath },
    {
      styleMap: ["p[style-name='Caption'] => p.docx-caption:fresh"],
      convertImage: mammoth.images.imgElement(async (image) => {
        const extension = IMAGE_EXTENSIONS.get(image.contentType);
        if (!extension) throw new Error(`Unsupported DOCX image type: ${image.contentType}`);
        const imageNumber = images.length + 1;
        const filename = `${slug}-figure-${imageNumber}.${extension}`;
        const buffer = Buffer.from(await image.read('base64'), 'base64');
        images.push({ filename, buffer });
        return { src: `/uploads/${filename}`, alt: '' };
      }),
    },
  );

  const service = createTurndownService();
  const { title, description, bodyHtml } = extractOpeningMetadata(result.value, service);
  const markdown = normalizeImportedMarkdown(service.turndown(bodyHtml));
  const wordCount = countWords(markdown);
  const readTime = `${Math.max(1, Math.round(wordCount / 220))} min read`;
  const document = buildBlogDocument({
    slug,
    title,
    seoTitle,
    description,
    publishedAt,
    readTime,
    markdown,
  });

  await fs.mkdir(outputDirectory, { recursive: true });
  await fs.mkdir(uploadsDirectory, { recursive: true });
  await fs.writeFile(path.join(outputDirectory, `${slug}.md`), document, 'utf8');
  for (const image of images) {
    await fs.writeFile(path.join(uploadsDirectory, image.filename), image.buffer);
  }

  return {
    slug,
    title,
    description,
    readTime,
    wordCount,
    imageFiles: images.map(({ filename }) => filename),
    messages: result.messages,
  };
};
