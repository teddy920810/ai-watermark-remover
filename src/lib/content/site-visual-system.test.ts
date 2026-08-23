import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const globalCss = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');
const homePage = readFileSync(new URL('../../pages/index.astro', import.meta.url), 'utf8');
const landingPage = readFileSync(new URL('../../components/LandingPage.astro', import.meta.url), 'utf8');
const uploader = readFileSync(new URL('../../components/uploader/ImageUploader.tsx', import.meta.url), 'utf8');

describe('site-wide blue visual system', () => {
  it('defines the reference-inspired blue, navy, surface, and success tokens', () => {
    expect(globalCss).toContain('--brand-blue: #2563eb;');
    expect(globalCss).toContain('--brand-navy: #0b1533;');
    expect(globalCss).toContain('--page: #f8fbff;');
    expect(globalCss).toContain('--success: #10b981;');
  });

  it('uses bold display typography and pill-shaped section labels', () => {
    expect(globalCss).toMatch(/\.hero h1\s*\{[^}]*font-weight:\s*850;/s);
    expect(globalCss).toMatch(/\.eyebrow\s*\{[^}]*border-radius:\s*999px;/s);
    expect(globalCss).toMatch(/\.eyebrow\s*\{[^}]*background:\s*var\(--brand-soft\);/s);
  });

  it('gives upload, process, guide, blog, and legal surfaces one card language', () => {
    expect(globalCss).toContain('.tool-card {');
    expect(globalCss).toContain('.upload-action {');
    expect(globalCss).toContain('.steps article {');
    expect(globalCss).toContain('.guide-grid article {');
    expect(globalCss).toContain('.blog-list article {');
    expect(globalCss).toContain('.legal-body {');
  });

  it('uses library icons for the upload and three-step journey', () => {
    expect(homePage).toContain("from '@lucide/astro'");
    expect(homePage).toContain('class="step-icon"');
    expect(landingPage).toContain("from '@lucide/astro'");
    expect(landingPage).toContain('class="step-icon"');
    expect(uploader).toContain("from 'lucide-react'");
    expect(uploader).toContain('className="upload-action"');
  });

  it('keeps the blue system readable on compact screens', () => {
    expect(globalCss).toContain('@media (max-width: 900px)');
    expect(globalCss).toContain('@media (max-width: 620px)');
    expect(globalCss).toMatch(/@media \(max-width: 620px\)[\s\S]*\.hero h1\s*\{/);
    expect(globalCss).toMatch(/@media \(max-width: 620px\)[\s\S]*\.drop-zone\s*\{/);
  });
});
