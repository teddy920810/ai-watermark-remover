import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('homepage feature assets', () => {
  it.each([
    'feature-auto-detection.svg',
    'feature-inpainting.svg',
    'feature-formats.svg',
  ])('ships %s in public/uploads for the CMS image field', (filename) => {
    expect(existsSync(new URL(`../../../public/uploads/${filename}`, import.meta.url))).toBe(true);
  });
});
