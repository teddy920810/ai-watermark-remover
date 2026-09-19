import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import YAML from 'yaml';

export const reservedToolSlugs = new Set(['api', 'auth', 'blog', 'privacy', 'terms', '404', 'robots', 'sitemap', 'robots.txt', 'sitemap.xml']);
export function parseCmsDocument(path, source) {
  if (path.endsWith('.json')) return { path, data: JSON.parse(source), body: '' };
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new Error(`${path}: missing frontmatter.`);
  return { path, data: YAML.parse(match[1]), body: match[2] };
}

export function readCmsDocuments(root) {
  const records = [];
  function walk(directory) {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(relative);
      else if (/\.(json|md|mdx)$/.test(entry.name)) records.push(parseCmsDocument(relative, readFileSync(join(root, relative), 'utf8')));
    }
  }
  for (const directory of ['src/content/landing-pages', 'src/content/blog']) walk(directory);
  return records;
}

export function collectPublicationIssues(records, root) {
  const issues = [];
  const seen = new Set();
  const publicRoutes = new Set(['/', '/blog', '/privacy', '/terms']);
  for (const record of records) {
    const landing = record.path.startsWith('src/content/landing-pages/');
    const route = `${landing ? '' : '/blog'}/${record.data.slug}`;
    if (seen.has(route)) issues.push(`${record.path}: duplicate / 重复 URL ${route}.`);
    seen.add(route);
    if (landing && reservedToolSlugs.has(record.data.slug)) issues.push(`${record.path}: reserved / 保留 URL ${route}.`);
    if (record.data.draft !== true) publicRoutes.add(route);
  }
  const checkString = (text, record) => {
    if (text.includes('【待替换】') || text.includes('/images/image-placeholder.svg')) {
      issues.push(`${record.path}: 发布前请替换所有【待替换】内容和模板占位图片，或保持草稿开启。`);
    }
    // Check local links/assets without contacting external services.
    const links = [...text.matchAll(/(?:\]\(|(?:href|src)=["'])(\/[^\s)"']+)/g)].map((match) => match[1]);
    if (text.startsWith('/') && !text.startsWith('//') && !/\s/.test(text)) links.push(text);
    for (const link of links) {
      const pathname = link.split(/[?#]/)[0].replace(/\/$/, '') || '/';
      if (pathname.startsWith('/uploads/') || pathname.startsWith('/images/')) {
        // Preserve the established image fallback for legacy operations content.
        if (record.data.templateVersion === 1 && root && !existsSync(resolve(root, 'public', `.${pathname}`))) issues.push(`${record.path}: 图片不存在 ${pathname}.`);
      } else if (!publicRoutes.has(pathname) && !pathname.startsWith('/api/')) {
        issues.push(`${record.path}: 链接不是已发布页面 ${pathname}.`);
      }
    }
  };
  const visit = (value, record) => {
    if (typeof value === 'string') checkString(value, record);
    else if (Array.isArray(value)) value.forEach((item) => visit(item, record));
    else if (value && typeof value === 'object') Object.values(value).forEach((item) => visit(item, record));
  };
  for (const record of records) {
    if (record.data.draft === true) continue;
    visit(record.data, record);
    checkString(record.body ?? '', record);
  }
  return [...new Set(issues)];
}

export function assertCmsPublication(root) {
  const issues = collectPublicationIssues(readCmsDocuments(root), root);
  if (issues.length) throw new Error(`CMS publication check failed:\n${issues.join('\n')}`);
}
