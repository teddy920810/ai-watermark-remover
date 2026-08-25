import { buildOptimizedImageSrcSet } from './optimized-image';
import { resolvePublicImageSource } from './image-fallback';
import { resolvePublicImageDimensions, type ImageDimensions } from './public-image-dimensions';

type ResolveDimensions = (src: string) => ImageDimensions | undefined;
type ResolveSource = (src: string) => string;

function addImageAttribute(tag: string, name: string, value: string | number): string {
  if (new RegExp(`\\s${name}\\s*=`, 'i').test(tag)) return tag;
  return tag.replace(/\s*\/?>(?=$)/, (ending) => ` ${name}="${value}"${ending.trimStart()}`);
}

export function optimizeTrustedHtmlImages(
  html: string,
  resolveDimensions: ResolveDimensions = resolvePublicImageDimensions,
  resolveSource: ResolveSource = resolvePublicImageSource,
): string {
  return html.replace(/<picture\b[\s\S]*?<\/picture>|<img\b[^>]*>/gi, (element) => {
    const imageTag = element.match(/<img\b[^>]*>/i)?.[0];
    if (!imageTag) return element;
    const source = imageTag.match(/\bsrc\s*=\s*(["'])(\/uploads\/[a-z0-9/_.-]+)\1/i)?.[2];
    if (!source) return element;
    const resolvedSource = resolveSource(source);
    if (resolvedSource !== source) {
      let fallback = imageTag.replace(/\bsrc\s*=\s*(["'])[^"']*\1/i, `src="${resolvedSource}"`);
      fallback = fallback.replace(/\s+srcset\s*=\s*(["'])[^"']*\1/gi, '').replace(/\s+sizes\s*=\s*(["'])[^"']*\1/gi, '');
      return addImageAttribute(fallback, 'data-image-fallback', 'true');
    }
    if (/^<picture\b/i.test(element)) return element;
    if (!/\.(?:jpe?g|png)$/i.test(source)) return element;
    const dimensions = resolveDimensions(source);
    const srcSet = dimensions ? buildOptimizedImageSrcSet(source, dimensions.width) : undefined;
    if (!dimensions || !srcSet) return element;

    let optimizedImage = addImageAttribute(element, 'width', dimensions.width);
    optimizedImage = addImageAttribute(optimizedImage, 'height', dimensions.height);
    optimizedImage = addImageAttribute(optimizedImage, 'loading', 'lazy');
    optimizedImage = addImageAttribute(optimizedImage, 'decoding', 'async');
    return `<picture class="responsive-blog-image"><source type="image/webp" srcset="${srcSet}" sizes="(max-width: 900px) calc(100vw - 40px), 784px">${optimizedImage}</picture>`;
  });
}
