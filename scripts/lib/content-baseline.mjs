import { createHash } from 'node:crypto';
import YAML from 'yaml';
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, stable(child)]));
  return value;
}
export function projectContent(file, source) {
  source = source.replace(/\r\n/g, '\n');
  if (file.endsWith('.json')) {
    const data = JSON.parse(source);
    if (file === 'src/content/settings/site.json') {
      const keep = link => !(link.label === 'Pricing' && link.href === '/pricing');
      data.header.navigation = data.header.navigation.filter(keep);
      data.footer.groups[1].links = data.footer.groups[1].links.filter(keep);
    }
    return data;
  }
  const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error('Content baseline requires YAML frontmatter');
  return { frontmatter: YAML.parse(match[1]), body: match[2] };
}
export const contentHash = data => createHash('sha256').update(JSON.stringify(stable(data))).digest('hex');
export function contentImages(data) {
  const images = [];
  function walk(value, prefix = '') {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      const current = prefix + '/' + key;
      if (typeof child === 'string' && /^(image|afterImage|imageAlt|afterImageAlt|alt|coverImage|coverAlt|shareImage)$/.test(key)) images.push({ path: current, value: child });
      else walk(child, current);
    }
  }
  walk(data);
  if (data.body) for (const match of data.body.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) images.push({ path: 'markdown', image: match[2], alt: match[1] });
  return images;
}
