import { isAbsolute, relative, resolve, sep } from 'node:path';
import { buildOptimizedImageSrcSet } from './optimized-image';
import { resolvePublicImageDimensions, type ImageDimensions } from './public-image-dimensions';

type MarkdownNode = {
  type: string;
  url?: string;
  alt?: string;
  title?: string;
  value?: string;
  children?: MarkdownNode[];
  [key: string]: unknown;
};

type MarkdownFile = { path?: string };

type OptimizedBlogImageOptions = {
  blogDirectory: string;
  resolveDimensions?: (src: string) => ImageDimensions | undefined;
};

function isInside(directory: string, filePath: string): boolean {
  const pathFromDirectory = relative(directory, resolve(filePath));
  return pathFromDirectory !== '..'
    && !pathFromDirectory.startsWith(`..${sep}`)
    && !isAbsolute(pathFromDirectory);
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function pictureMarkup(node: MarkdownNode, dimensions: ImageDimensions): string | undefined {
  const src = node.url!;
  const srcSet = buildOptimizedImageSrcSet(src, dimensions.width);
  if (!srcSet) return undefined;
  const title = node.title ? ` title="${escapeAttribute(node.title)}"` : '';
  return `<picture class="responsive-blog-image"><source type="image/webp" srcset="${srcSet}" sizes="(max-width: 900px) calc(100vw - 40px), 784px"><img src="${escapeAttribute(src)}" alt="${escapeAttribute(node.alt ?? '')}"${title} width="${dimensions.width}" height="${dimensions.height}" loading="lazy" decoding="async"></picture>`;
}

export function optimizeBlogImages(options: OptimizedBlogImageOptions) {
  const blogDirectory = resolve(options.blogDirectory);
  const resolveDimensions = options.resolveDimensions ?? resolvePublicImageDimensions;

  return function transform(tree: MarkdownNode, file: MarkdownFile): void {
    if (!file.path || !isInside(blogDirectory, file.path)) return;

    const visit = (node: MarkdownNode): void => {
      if (node.type === 'image' && node.url) {
        const dimensions = resolveDimensions(node.url);
        const markup = dimensions ? pictureMarkup(node, dimensions) : undefined;
        if (markup) {
          for (const key of Object.keys(node)) delete node[key];
          node.type = 'html';
          node.value = markup;
          return;
        }
      }
      node.children?.forEach(visit);
    };

    visit(tree);
  };
}
