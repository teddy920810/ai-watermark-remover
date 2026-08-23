import { buildOptimizedImageSrcSet } from './optimized-image';
import { resolvePublicImageDimensions, type ImageDimensions } from './public-image-dimensions';

type ResolveDimensions = (src: string) => ImageDimensions | undefined;

function addImageAttribute(tag: string, name: string, value: string | number): string {
  if (new RegExp(`\\s${name}\\s*=`, 'i').test(tag)) return tag;
  return tag.replace(/\s*\/?>(?=$)/, (ending) => ` ${name}="${value}"${ending.trimStart()}`);
}

export function optimizeTrustedHtmlImages(
  html: string,
  resolveDimensions: ResolveDimensions = resolvePublicImageDimensions,
): string {
  return html.replace(/<picture\b[\s\S]*?<\/picture>|<img\b[^>]*>/gi, (element) => {
    if (/^<picture\b/i.test(element)) return element;
    const source = element.match(/\bsrc\s*=\s*(["'])(\/uploads\/[a-z0-9/_-]+\.(?:jpe?g|png))\1/i)?.[2];
    if (!source) return element;
    const dimensions = resolveDimensions(source);
    const srcSet = dimensions ? buildOptimizedImageSrcSet(source, dimensions.width) : undefined;
    if (!dimensions || !srcSet) return element;

    let image = addImageAttribute(element, 'width', dimensions.width);
    image = addImageAttribute(image, 'height', dimensions.height);
    image = addImageAttribute(image, 'loading', 'lazy');
    image = addImageAttribute(image, 'decoding', 'async');
    return `<picture class="responsive-blog-image"><source type="image/webp" srcset="${srcSet}" sizes="(max-width: 900px) calc(100vw - 40px), 784px">${image}</picture>`;
  });
}
