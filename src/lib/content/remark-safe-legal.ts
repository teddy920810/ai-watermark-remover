import { isAbsolute, relative, resolve, sep } from 'node:path';

interface MarkdownNode {
  type: string;
  url?: string;
  children?: MarkdownNode[];
}

function safeLegalLink(value: string): boolean {
  if (/[\s\\]/u.test(value) || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return false;
  if (value.startsWith('#')) return true;
  if (value.startsWith('/')) return !value.startsWith('//');
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' && !url.username && !url.password)
      || (url.protocol === 'mailto:' && url.pathname.includes('@'));
  } catch {
    return false;
  }
}

/** Reject unsupported legal copy before Astro turns its Markdown into HTML.
 * https://docs.astro.build/en/guides/markdown-content/#markdown-plugins
 */
export function safeLegalMarkdown({ legalDirectory }: { legalDirectory: string }) {
  const directory = resolve(legalDirectory);
  return (tree: MarkdownNode, file: { path?: string }): void => {
    if (!file.path) return;
    const source = relative(directory, resolve(file.path));
    if (source === '..' || source.startsWith(`..${sep}`) || isAbsolute(source)) return;
    const visit = (node: MarkdownNode): void => {
      if (node.type === 'html') throw new Error('Legal Markdown does not support raw HTML. Use Markdown formatting or escaped code examples.');
      if (['link', 'definition', 'image'].includes(node.type) && node.url && !safeLegalLink(node.url)) {
        throw new Error('Legal Markdown links must use HTTPS, mailto, a site-relative path or a fragment.');
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
