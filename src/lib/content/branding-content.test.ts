import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const contentFiles = [
  '../../content/settings/site.json',
  '../../content/settings/blog.json',
  '../../content/settings/not-found.json',
  '../../content/legal/privacy.md',
  '../../content/legal/terms.md',
  '../../content/blog/how-to-remove-watermarks-responsibly.md',
];

describe('public brand content', () => {
  it('uses WatermarkGemini consistently and gives the image-format guide a focused title', () => {
    const content = contentFiles.map((file) => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');
    const imageGuide = readFileSync(new URL('../../content/blog/jpg-png-webp-image-format-guide.md', import.meta.url), 'utf8');

    expect(content).not.toContain('ClearMark AI');
    expect(imageGuide).toContain('title: "JPG vs PNG vs WebP: Best Image Format for Your Website"');
  });
});
