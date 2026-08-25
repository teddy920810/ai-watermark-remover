import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { cwd } from 'node:process';
import { IMAGE_PLACEHOLDER_SRC } from './image-fallback-constants';

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
  publicDirectory?: string;
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

function referencedAssetPath(markdownPath: string, url: string, publicDirectory: string): string | undefined {
  if (isRelativeAsset(url)) return assetPath(markdownPath, url);
  if (/^\/uploads\/[a-z0-9][a-z0-9._/-]*$/i.test(url) && !url.includes('..')) {
    return resolve(publicDirectory, url.slice(1));
  }
  return undefined;
}

export function replaceMissingBlogImages(options: MissingBlogImageOptions) {
  const blogDirectory = resolve(options.blogDirectory);
  const publicDirectory = resolve(options.publicDirectory ?? resolve(cwd(), 'public'));
  const exists = options.exists ?? existsSync;
  const warn = options.warn ?? console.warn;

  return function transform(tree: MarkdownNode, file: MarkdownFile): void {
    if (!file.path || !isInside(blogDirectory, file.path)) return;

    const source = relative(blogDirectory, resolve(file.path));
    const visit = (node: MarkdownNode): void => {
      const referencedPath = node.type === 'image' && node.url
        ? referencedAssetPath(file.path!, node.url, publicDirectory)
        : undefined;
      if (node.type === 'image' && node.url && referencedPath && !exists(referencedPath)) {
        const missingUrl = node.url;
        node.url = IMAGE_PLACEHOLDER_SRC;
        warn(`[content] Missing blog image replaced with placeholder: ${source} -> ${missingUrl}`);
        return;
      }
      node.children?.forEach(visit);
    };

    visit(tree);
  };
}
