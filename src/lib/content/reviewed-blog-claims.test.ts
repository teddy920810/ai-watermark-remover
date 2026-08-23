import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const importedPosts = [
  'how-to-remove-watermark-from-gif.md',
  'how-to-remove-grok-watermark.md',
  'how-to-remove-gamma-watermark.md',
  'how-to-remove-notebooklm-watermark.md',
];

describe('reviewed Word blog product claims', () => {
  it.each(importedPosts)('%s states the current mock-processing boundary', (filename) => {
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src', 'content', 'blog', filename),
      'utf8',
    );

    expect(content).toContain('does not currently remove watermarks');
    expect(content).not.toMatch(/WatermarkGemini can (?:clean|handle|process|provide)/i);
    expect(content).not.toContain('WatermarkGemini is an image watermark remover');
  });
});
