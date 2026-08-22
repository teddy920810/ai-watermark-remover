import { describe, expect, it } from 'vitest';
import { resolvePublicImageDimensions } from './public-image-dimensions';

describe('public image dimensions', () => {
  it('reads dimensions without depending on mutable CMS-managed media', () => {
    const png = Buffer.alloc(24);
    png.write('PNG', 1, 'ascii');
    png.writeUInt32BE(640, 16);
    png.writeUInt32BE(480, 20);

    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 8, 8, 0x04, 0xc4, 0x04, 0xc4, 0]);

    expect(resolvePublicImageDimensions('/uploads/example.png', () => png)).toEqual({
      width: 640,
      height: 480,
    });
    expect(resolvePublicImageDimensions('/uploads/example.jpg', () => jpeg)).toEqual({
      width: 1220,
      height: 1220,
    });
  });

  it('returns undefined for paths outside the managed public uploads directory', () => {
    expect(resolvePublicImageDimensions('/../package.json')).toBeUndefined();
    expect(resolvePublicImageDimensions('https://example.test/image.webp')).toBeUndefined();
  });
});
