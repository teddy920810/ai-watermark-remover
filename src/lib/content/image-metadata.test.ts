import { describe, expect, it } from 'vitest';
import { imageSettingsSchema, resolveImageAlt } from './image-metadata';

describe('managed image metadata', () => {
  const images = [
    { src: '/uploads/guide.webp', alt: 'A before-and-after image cleanup example', title: 'Cleanup example' },
  ];

  it('uses a page-specific alt override before reusable metadata', () => {
    expect(resolveImageAlt('/uploads/guide.webp', 'Article-specific description', images, 'Fallback'))
      .toBe('Article-specific description');
    expect(resolveImageAlt('/uploads/guide.webp', undefined, images, 'Fallback'))
      .toBe('A before-and-after image cleanup example');
  });

  it('falls back safely for an unregistered image', () => {
    expect(resolveImageAlt('/uploads/other.webp', undefined, images, 'Article title')).toBe('Article title');
  });

  it('rejects duplicate image paths', () => {
    expect(imageSettingsSchema.safeParse({ images: [...images, images[0]] }).success).toBe(false);
  });
});
