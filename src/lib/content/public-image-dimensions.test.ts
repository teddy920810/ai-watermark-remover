import { describe, expect, it } from 'vitest';
import { resolvePublicImageDimensions } from './public-image-dimensions';

describe('public image dimensions', () => {
  it('reads dimensions without rewriting CMS-managed media', () => {
    expect(resolvePublicImageDimensions('/uploads/simple-before-after-watermark-removal-1.webp')).toEqual({
      width: 2922,
      height: 1382,
    });
    expect(resolvePublicImageDimensions('/uploads/21a54f0d-1ee6-4e2f-9ee0-bd06e7fb167e.jpg')).toEqual({
      width: 1220,
      height: 1220,
    });
  });

  it('returns undefined for paths outside the managed public uploads directory', () => {
    expect(resolvePublicImageDimensions('/../package.json')).toBeUndefined();
    expect(resolvePublicImageDimensions('https://example.test/image.webp')).toBeUndefined();
  });
});
