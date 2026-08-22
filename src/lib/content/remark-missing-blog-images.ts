import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

type MarkdownNode = {
  type: string;
  url?: string;
  value?: string;
  children?: MarkdownNode[];
  [key: string]: unknown;
};

type MarkdownFile = { path?: string };

type MissingBlogImageOptions = {
  blogDirectory: string;
  exists?: (path: string) => boolean;
  warn?: (message: string) => void;
};

function isInside(directory: string, filePath: string): boolean {
  const pathFromDirectory = relative(directory, resolve(filePath));
  return pathFromDirectory !== '..'
    && !pathFromDirectory.startsWith(`..${sep}`)
    && !isAbsolute(pathFromDirectory);
}

function isRelativeAsset(url: string): boolean {
  return !url.startsWith('/')
    && !url.startsWith('//')
    && !url.startsWith('#')
    && !/^[a-z][a-z\d+.-]*:/i.test(url);
}

function assetPath(markdownPath: string, url: string): string {
  const cleanUrl = url.split(/[?#]/, 1)[0];
  let decodedUrl = cleanUrl;
  try {
    decodedUrl = decodeURIComponent(cleanUrl);
  } catch {
    // Invalid URL escapes are left unchanged and will simply be reported missing.
  }
  return resolve(markdownPath, '..', decodedUrl);
}

function omitImage(node: MarkdownNode, url: string): void {
  for (const key of Object.keys(node)) delete node[key];
  node.type = 'html';
  node.value = `<!-- Missing blog image omitted: ${url.replaceAll('--', '- -')} -->`;
}

export function omitMissingBlogImages(options: MissingBlogImageOptions) {
  const blogDirectory = resolve(options.blogDirectory);
  const exists = options.exists ?? existsSync;
  const warn = options.warn ?? console.warn;

  return function transform(tree: MarkdownNode, file: MarkdownFile): void {
    if (!file.path || !isInside(blogDirectory, file.path)) return;

    const source = relative(blogDirectory, resolve(file.path));
    const visit = (node: MarkdownNode): void => {
      if (node.type === 'image' && node.url && isRelativeAsset(node.url) && !exists(assetPath(file.path!, node.url))) {
        const missingUrl = node.url;
        omitImage(node, missingUrl);
        warn(`[content] Missing blog image omitted: ${source} -> ${missingUrl}`);
        return;
      }
      node.children?.forEach(visit);
    };

    visit(tree);
  };
}
