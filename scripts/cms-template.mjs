import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { URL } from 'node:url';
import YAML from 'yaml';
import { parseCmsDocument, readCmsDocuments, reservedToolSlugs } from './cms-publication.mjs';

export async function createCmsDraft(root, payload, date = new Date().toISOString().slice(0, 10)) {
  const kinds = new Map([['create-blog-draft', 'blog'], ['create-landing-draft', 'landing']]);
  const kind = kinds.get(payload?.action?.name);
  if (!kind) throw new Error('Unsupported template action.');
  const { title, slug } = payload.inputs ?? {};
  if (typeof title !== 'string' || !title.trim() || title.length > 180 || [...title].some((char) => char.charCodeAt(0) < 32)) throw new Error('请填写单行标题（最多 180 字符）。');
  if (typeof slug !== 'string' || slug.length > 100 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('URL 只能使用小写字母、数字和连字符（最多 100 字符）。');
  if (kind === 'landing' && reservedToolSlugs.has(slug)) throw new Error('该 URL 是站点保留路径，请换一个。');
  const directory = `src/content/${kind === 'blog' ? 'blog' : 'landing-pages'}`;
  const existing = readCmsDocuments(root);
  if (existing.some((record) => record.path.startsWith(`${directory}/`) && record.data.slug === slug)) throw new Error('URL 已存在 / already exists，请换一个；原页面未修改。');
  const extension = kind === 'blog' ? 'md' : 'json';
  const template = await readFile(new URL(`../cms-templates/${kind}.${extension}`, import.meta.url), 'utf8');
  const { data, body } = parseCmsDocument(`template.${extension}`, template);
  Object.assign(data, { slug, title: title.trim(), draft: true });
  if (kind === 'blog') Object.assign(data, { publishedAt: date, featured: false });
  else data.heading = title.trim();
  const path = `${directory}/${slug}.${extension}`;
  const source = kind === 'blog' ? `---\n${YAML.stringify(data)}---\n${body}` : `${JSON.stringify(data, null, 2)}\n`;
  await mkdir(join(root, directory), { recursive: true });
  await writeFile(join(root, path), source, { flag: 'wx' });
  return { path, data, body };
}
