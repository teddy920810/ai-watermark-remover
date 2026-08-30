import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sourcePath = new URL('../../components/uploader/ObjectRemoverUploader.tsx', import.meta.url);

describe('ObjectRemoverUploader contract', () => {
  it('keeps the manual blue mask tools and omits Auto Removal', () => {
    const source = readFileSync(sourcePath, 'utf8');
    expect(source).toContain('Brush');
    expect(source).toContain('Lasso');
    expect(source).toContain('Eraser');
    expect(source).toContain('#2563eb');
    expect(source).not.toContain('Auto Removal');
  });

  it('expands the hero after upload and exports a black and white mask', () => {
    const source = readFileSync(sourcePath, 'utf8');
    expect(source).toContain("classList.toggle('is-tool-expanded'");
    expect(source).toContain("fillStyle = '#000000'");
    expect(source).toContain("fillStyle = '#ffffff'");
    expect(source).toContain("operation: 'object-removal'");
  });
});
