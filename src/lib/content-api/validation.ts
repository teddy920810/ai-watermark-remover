import { z } from 'zod';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import sharp from 'sharp';
import { blogEntrySchema, landingEntrySchema } from '../content/entry-schemas';
import { reservedToolSlugs } from '../contracts/route-policy.mjs';

export const limits = { requestBytes: 3_000_000, imageBytes: 2_000_000, maxDimension: 6000, maxPixels: 24_000_000, bodyCharacters: 100_000, entriesPerChange: 20, assetsPerChange: 30 };
export const kinds = ['landing', 'blog'] as const;
export type ContentKind = typeof kinds[number];
export interface ContentEntry { data: Record<string, unknown>; body: string }
export class ContentError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
export function fail(status: number, code: string, message: string): never { throw new ContentError(status, code, message); }
export const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail(422, 'INVALID_DOCUMENT', 'Expected a JSON object.');
export function exact(value: Record<string, unknown>, keys: string[]) { if (Object.keys(value).some(key => !keys.includes(key))) fail(422, 'UNKNOWN_FIELD', 'Unknown fields are not accepted.'); }
export function slug(value: string) { if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || value.length > 100) fail(422, 'INVALID_SLUG', 'Use a lowercase ASCII slug with hyphens, at most 100 characters.'); return value; }
export function entryPath(kind: string, value: string) {
  if (!kinds.includes(kind as ContentKind)) fail(404, 'NOT_FOUND', 'Unknown content kind.');
  slug(value); if (kind === 'landing' && reservedToolSlugs.has(value)) fail(422, 'RESERVED_SLUG', 'This tool URL is reserved.');
  return `src/content/${kind === 'landing' ? 'landing-pages' : 'blog'}/${value}.${kind === 'landing' ? 'json' : 'md'}`;
}
export const contentPath = (path: string) => /^src\/content\/(?:blog\/[a-z0-9-]+\.md|landing-pages\/[a-z0-9-]+\.json)$/.test(path);
export function safeLink(value: string, image = false) {
  if (/[\s\\]/.test(value) || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return false;
  if (image) return /^\/(?:uploads|images)\/[A-Za-z0-9_./-]+$/.test(value) && !value.split('/').some(part => part === '.' || part === '..');
  if (value.startsWith('#')) return /^#[A-Za-z0-9_-]*$/.test(value);
  if (value.startsWith('/') && !value.startsWith('//')) return !value.split(/[/?#]/).some(part => part === '.' || part === '..') && !/^\/(?:api|auth)(?:\/|$)/.test(value);
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}
interface MarkdownNode { type: string; url?: string; alt?: string | null; value?: string; children?: MarkdownNode[] }
export function markdownIssues(body: string): string[] {
  const issues: string[] = [];
  if (/(?:^|\n)\s*(?:import|export)\s/.test(body)) issues.push('MDX imports and exports are not supported.');
  const visit = (node: MarkdownNode) => {
    if (node.type === 'html') issues.push('Raw HTML is not supported in Markdown; use safe HTML mode.');
    if (['link', 'definition', 'image'].includes(node.type) && node.url && !safeLink(node.url, node.type === 'image')) issues.push('Unsafe link or image URL.');
    if (['image', 'imageReference'].includes(node.type) && !node.alt?.trim()) issues.push('Every image requires alt text.');
    node.children?.forEach(visit);
  };
  visit(unified().use(remarkParse).parse(body) as MarkdownNode); return issues;
}
const htmlTags = new Set('p br hr h2 h3 h4 h5 h6 strong em b i u s del blockquote ul ol li a img figure figcaption table thead tbody tfoot tr th td pre code'.split(' '));
const htmlAttributes: Record<string, string[]> = { a: ['href', 'title'], img: ['src', 'alt', 'title', 'width', 'height', 'loading'], th: ['colspan', 'rowspan'], td: ['colspan', 'rowspan'], ol: ['start'] };
/** Browser-compatible HTML parser; reject unsupported markup rather than silently rewriting operator copy. https://parse5.js.org/functions/parse5.parseFragment.html */
export function htmlIssues(html: string): string[] {
  const issues: string[] = [];
  function visit(node: DefaultTreeAdapterMap['node']) {
    if ('tagName' in node) {
      if (node.namespaceURI !== 'http://www.w3.org/1999/xhtml' || !htmlTags.has(node.tagName)) issues.push(`Unsupported HTML element: ${node.tagName}.`);
      for (const attr of node.attrs) {
        if (!(htmlAttributes[node.tagName] ?? []).includes(attr.name) || attr.namespace || attr.prefix) issues.push(`Unsupported HTML attribute: ${attr.name}.`);
        if (['href', 'src'].includes(attr.name) && !safeLink(attr.value, attr.name === 'src')) issues.push('Unsafe HTML URL.');
        if (['width', 'height', 'colspan', 'rowspan', 'start'].includes(attr.name) && !/^[1-9]\d{0,3}$/.test(attr.value)) issues.push('Invalid HTML numeric attribute.');
        if (attr.name === 'loading' && !['lazy', 'eager'].includes(attr.value)) issues.push('Invalid loading attribute.');
      }
      if (node.tagName === 'img' && (!node.attrs.some(a => a.name === 'src') || !node.attrs.some(a => a.name === 'alt' && a.value.trim()))) issues.push('Every image requires src and alt.');
    }
    if ('childNodes' in node) node.childNodes.forEach(visit);
  }
  visit(parseFragment(html)); return issues;
}
function omittedFields(input: unknown, parsed: unknown): boolean {
  if (Array.isArray(input)) return input.some((item, i) => omittedFields(item, (parsed as unknown[])?.[i]));
  if (input && typeof input === 'object') return Object.entries(input).some(([key, child]) => !parsed || typeof parsed !== 'object' || !Object.hasOwn(parsed, key) || omittedFields(child, (parsed as Record<string, unknown>)[key]));
  return false;
}
export function parseEntry(kind: ContentKind, value: unknown, targetSlug: string, existing?: ContentEntry): ContentEntry {
  const input = object(value); exact(input, ['data', 'body']);
  const data = object(input.data); if (data.slug !== targetSlug) fail(422, 'IMMUTABLE_SLUG', 'The document slug must match its URL. Renaming published URLs is not supported.');
  for (const key of ['publishedAt', 'updatedAt']) if (typeof data[key] === 'string' && (Number.isNaN(Date.parse(data[key])) || new Date(data[key]).toISOString().slice(0, 10) !== data[key])) fail(422, 'INVALID_DATE', 'Dates must be real calendar dates in YYYY-MM-DD format.');
  const parsed = (kind === 'blog' ? blogEntrySchema : landingEntrySchema).safeParse(data);
  if (!parsed.success) throw new ContentError(422, 'SCHEMA_INVALID', 'Content fields are invalid.', parsed.error.issues.map(i => ({ path: i.path, message: i.message })));
  if (omittedFields(data, parsed.data)) fail(422, 'UNKNOWN_FIELD', 'Unrecognized or empty fields would be discarded.');
  const body = input.body === undefined ? '' : typeof input.body === 'string' ? input.body : fail(422, 'INVALID_BODY', 'Body must be a string.');
  if (body.length > limits.bodyCharacters || (kind === 'landing' && body)) fail(422, 'INVALID_BODY', 'Body is too long or unsupported for this kind.');
  const issues: string[] = kind === 'blog' ? [...(data.contentMode === 'html' ? [] : markdownIssues(body)), ...(data.bodyHtml ? htmlIssues(String(data.bodyHtml)) : [])] : [];
  function walk(value: unknown, previous?: unknown) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      // Marketing metadata and FAQ text also enter JSON-LD script elements.
      if (typeof child === 'string' && /<(?:\/?script\b|!--)/i.test(child)) issues.push('Script delimiters and HTML comments are not allowed in content fields.');
      if (typeof child === 'string' && ['image', 'afterImage', 'coverImage', 'beforeImage', 'shareImage'].includes(key) && !safeLink(child, true)) issues.push(`Invalid public image field: ${key}.`);
      if (typeof child === 'string' && /href$/i.test(key) && !safeLink(child)) issues.push(`Invalid link field: ${key}.`);
      const old = previous && typeof previous === 'object' ? (previous as Record<string, unknown>)[key] : undefined;
      if (key === 'comparison' && child && JSON.stringify(child) !== JSON.stringify(old)) issues.push('Legacy comparison presets are read-only. Supply image and afterImage instead.');
      if (child && typeof child === 'object') walk(child, old);
    }
  }
  walk(data, existing?.data);
  if (data.coverImage && !(typeof data.coverAlt === 'string' && data.coverAlt.trim())) issues.push('Cover image requires coverAlt.');
  if (kind === 'blog' && data.contentMode === 'html' && body.trim()) issues.push('HTML mode requires an empty Markdown body.');
  for (const path of entryImages({ data, body }).paths) if (!safeLink(path, true)) issues.push('Images must reference public /uploads or /images paths.');
  if (issues.length) throw new ContentError(422, 'UNSAFE_CONTENT', 'Content is outside the supported safe subset.', [...new Set(issues)]);
  return { data: { ...parsed.data, draft: data.draft ?? true }, body };
}
export function entryImages(entry: ContentEntry): { paths: string[]; pairs: [string, string][] } {
  const paths: string[] = []; const pairs: [string, string][] = [];
  function walk(value: unknown) {
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (typeof record.image === 'string' && typeof record.afterImage === 'string') pairs.push([record.image, record.afterImage]);
    for (const [key, child] of Object.entries(record)) {
      if (typeof child === 'string' && ['image', 'afterImage', 'coverImage', 'beforeImage', 'shareImage'].includes(key)) paths.push(child);
      else if (child && typeof child === 'object') walk(child);
    }
  }
  walk(entry.data);
  if (entry.data.contentMode === 'html') {
    function html(node: DefaultTreeAdapterMap['node']) { if ('tagName' in node && node.tagName === 'img') { const src = node.attrs.find(a => a.name === 'src')?.value; if (src) paths.push(src); } if ('childNodes' in node) node.childNodes.forEach(html); }
    html(parseFragment(String(entry.data.bodyHtml ?? '')));
  } else {
    const tree = unified().use(remarkParse).parse(entry.body) as MarkdownNode;
    const definitions = new Map<string, string>();
    const identifier = (node: MarkdownNode) => String((node as MarkdownNode & { identifier?: string }).identifier);
    const scan = (node: MarkdownNode) => { if (node.type === 'definition' && node.url) definitions.set(identifier(node), node.url); node.children?.forEach(scan); };
    scan(tree);
    const visit = (node: MarkdownNode) => { if (node.type === 'image' && node.url) paths.push(node.url); if (node.type === 'imageReference') { const url = definitions.get(identifier(node)); if (url) paths.push(url); } node.children?.forEach(visit); };
    visit(tree);
  }
  return { paths: [...new Set(paths)], pairs };
}
export async function inspectImage(bytes: Buffer, mime: string) {
  if (!bytes.length || bytes.length > limits.imageBytes) fail(413, 'ASSET_TOO_LARGE', 'Image must be nonempty and at most 2,000,000 bytes.');
  const ext = mime === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'png'
    : mime === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'jpg'
    : mime === 'image/webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : null;
  if (!ext) fail(415, 'ASSET_TYPE', 'JPEG, PNG or WebP MIME and file signature must match.');
  try {
    const image = sharp(bytes, { limitInputPixels: limits.maxPixels, animated: true }); const meta = await image.metadata();
    if (!meta.width || !meta.height || meta.width > limits.maxDimension || meta.height > limits.maxDimension || (meta.pages ?? 1) !== 1) fail(422, 'ASSET_DIMENSIONS', 'Use one frame, 1–6000 pixels per side and at most 24 million pixels.');
    await image.stats(); // Full decode, not just header inspection. Original bytes are preserved.
    return { extension: ext, width: meta.width, height: meta.height, bytes: bytes.length, mime };
  } catch (error) { if (error instanceof ContentError) throw error; return fail(422, 'ASSET_DECODE', 'Image cannot be decoded within the image limits.'); }
}
export function publicSchema() {
  const blog = z.toJSONSchema(blogEntrySchema, { io: 'input', unrepresentable: 'any' });
  const landing = z.toJSONSchema(landingEntrySchema, { io: 'input', unrepresentable: 'any' });
  for (const schema of [blog, landing]) if (schema.properties?.draft && typeof schema.properties.draft === 'object') schema.properties.draft.default = true;
  return { kinds, limits, blogComparison: false, blog, landing };
}
