import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IMAGE_PLACEHOLDER_SRC, resolvePublicImageSource } from './image-fallback';

describe('site-wide image fallback', () => {
  it('keeps existing CMS assets and replaces missing CMS assets with the shared placeholder', () => {
    const publicDirectory = resolve('repo', 'public');
    const exists = (path: string) => path === resolve(publicDirectory, 'uploads', 'existing.webp');

    expect(resolvePublicImageSource('/uploads/existing.webp', exists, publicDirectory)).toBe('/uploads/existing.webp');
    expect(resolvePublicImageSource('/uploads/missing.webp', exists, publicDirectory)).toBe(IMAGE_PLACEHOLDER_SRC);
  });

  it('does not rewrite remote, generated, API, unsafe, or placeholder sources', () => {
    const sources = [
      'https://example.com/image.png',
      '/generated/uploads/example.png-480.webp',
      '/api/jobs/result',
      '/uploads/../secret.png',
      IMAGE_PLACEHOLDER_SRC,
    ];

    for (const source of sources) {
      expect(resolvePublicImageSource(source, () => false, resolve('repo', 'public'))).toBe(source);
    }
  });
});
