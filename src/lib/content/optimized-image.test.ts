import { describe, expect, it } from 'vitest';
import {
  buildOptimizedImageSrcSet,
  optimizedImagePath,
  responsiveImageWidths,
} from './optimized-image';

describe('optimized public images', () => {
  it('builds deterministic responsive WebP paths without changing the CMS source path', () => {
    expect(optimizedImagePath('/uploads/guides/example.png', 480))
      .toBe('/generated/uploads/guides/example.png-480.webp');
    expect(responsiveImageWidths('/uploads/guides/example.png', 1672)).toEqual([480, 768, 1200]);
    expect(buildOptimizedImageSrcSet('/uploads/guides/example.png', 1672)).toBe(
      '/generated/uploads/guides/example.png-480.webp 480w, '
      + '/generated/uploads/guides/example.png-768.webp 768w, '
      + '/generated/uploads/guides/example.png-1200.webp 1200w',
    );
  });

  it('keeps the original width for small images and skips formats that should not be re-encoded', () => {
    expect(responsiveImageWidths('/uploads/example.jpg', 640)).toEqual([480, 640]);
    expect(responsiveImageWidths('/uploads/example.webp', 1200)).toEqual([]);
    expect(responsiveImageWidths('/uploads/example.svg', 1200)).toEqual([]);
    expect(responsiveImageWidths('/other/example.png', 1200)).toEqual([]);
  });
});
