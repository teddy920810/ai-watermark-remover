import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./BackgroundRemoverUploader.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');

describe('BackgroundRemoverUploader source contract', () => {
  it('uses the dedicated operation and supports file, drag, and clipboard selection', () => {
    expect(source).toContain("operation: 'background-removal'");
    expect(source).toContain("addEventListener('paste'");
    expect(source).toContain('onDrop={onDrop}');
    expect(source).toContain('type="file"');
  });

  it('offers transparent, preset, and custom backgrounds without an editor branch', () => {
    expect(source).toContain('background-color-panel');
    expect(source).toContain('background-swatch');
    expect(source).toContain('type="color"');
    expect(source).toContain('Download PNG');
    expect(source).not.toContain('Go to Editor');
    expect(css).toContain('/uploads/background-remover-transparency-grid.png');
  });

  it('expands the tool after selection and defaults the completed view to the provider result', () => {
    expect(source).toContain("classList.toggle('is-tool-expanded', expanded)");
    expect(source).toContain('const [showOriginal, setShowOriginal] = useState(false)');
    expect(source).toContain('showOriginal ? state.previewUrl : state.resultUrl');
    expect(css).toContain('.hero-inner.is-tool-expanded');
  });
});
