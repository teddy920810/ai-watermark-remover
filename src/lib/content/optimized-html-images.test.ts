import { describe, expect, it } from 'vitest';
import { IMAGE_PLACEHOLDER_SRC } from './image-fallback';
import { optimizeTrustedHtmlImages } from './optimized-html-images';

describe('optimized trusted HTML images', () => {
  it('wraps CMS raster images with WebP sources and retains the original tag', () => {
    const html = '<p><img src="/uploads/example.jpg" alt="Example"></p>';
    const output = optimizeTrustedHtmlImages(html, () => ({ width: 960, height: 540 }), (source) => source);

    expect(output).toContain('<picture class="responsive-blog-image">');
    expect(output).toContain('/generated/uploads/example.jpg-960.webp 960w');
    expect(output).toContain('<img src="/uploads/example.jpg" alt="Example" width="960" height="540" loading="lazy" decoding="async">');
  });

  it('does not rewrite existing picture content, WebP, SVG, or remote images', () => {
    const html = [
      '<picture><img src="/uploads/already.png" alt="Already optimized"></picture>',
      '<img src="/uploads/example.webp" alt="WebP">',
      '<img src="/uploads/example.svg" alt="SVG">',
      '<img src="https://example.com/image.png" alt="Remote">',
    ].join('');

    expect(optimizeTrustedHtmlImages(html, () => ({ width: 960, height: 540 }), (source) => source)).toBe(html);
  });

  it('replaces missing CMS images inside plain img and picture markup', () => {
    const html = [
      '<img src="/uploads/missing.webp" alt="Missing plain">',
      '<picture><source srcset="/generated/uploads/missing.png-480.webp 480w"><img src="/uploads/missing.png" alt="Missing responsive"></picture>',
    ].join('');

    const output = optimizeTrustedHtmlImages(html, () => undefined, () => IMAGE_PLACEHOLDER_SRC);

    expect(output).toBe([
      `<img src="${IMAGE_PLACEHOLDER_SRC}" alt="Missing plain" data-image-fallback="true">`,
      `<img src="${IMAGE_PLACEHOLDER_SRC}" alt="Missing responsive" data-image-fallback="true">`,
    ].join(''));
  });
});
