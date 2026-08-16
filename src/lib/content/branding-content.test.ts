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
  it('does not retain the superseded brand name', () => {
    const content = contentFiles.map((file) => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');

    expect(content).not.toContain('ClearMark AI');
  });
});
