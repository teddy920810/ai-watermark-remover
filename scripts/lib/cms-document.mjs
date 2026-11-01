import YAML from 'yaml';
export function parseCmsDocument(path, source) {
  if (path.endsWith('.json')) return { path, data: JSON.parse(source), body: '' };
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new Error(`${path}: missing frontmatter.`);
  return { path, data: YAML.parse(match[1]), body: match[2] };
}

