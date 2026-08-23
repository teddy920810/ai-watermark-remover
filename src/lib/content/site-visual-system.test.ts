import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const globalCss = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');
const homePage = readFileSync(new URL('../../pages/index.astro', import.meta.url), 'utf8');
const landingPage = readFileSync(new URL('../../components/LandingPage.astro', import.meta.url), 'utf8');
const uploader = readFileSync(new URL('../../components/uploader/ImageUploader.tsx', import.meta.url), 'utf8');

describe('site-wide operations visual system', () => {
  it('defines the supplied mockup blue, ink, cream, surface, and success tokens', () => {
    expect(globalCss).toContain('--brand-blue: #3975ff;');
    expect(globalCss).toContain('--brand-navy: #172033;');
    expect(globalCss).toContain('--page: #ffffff;');
    expect(globalCss).toContain('--section-cream: #fbfaf7;');
    expect(globalCss).toContain('--success: #43a677;');
  });

  it('uses the supplied display and body typography with pill-shaped section labels', () => {
    expect(globalCss).toContain('--font-display: "Plus Jakarta Sans"');
    expect(globalCss).toContain('--font-body: "DM Sans"');
    expect(globalCss).toMatch(/\.hero h1\s*\{[^}]*font-family:\s*var\(--font-display\);/s);
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

  it('uses full-width airy surfaces from the supplied mockup to separate screens', () => {
    expect(globalCss).toContain('--section-ice: #f2f6ff;');
    expect(globalCss).toContain('--section-white: #ffffff;');
    expect(globalCss).toContain('--section-cream: #fbfaf7;');
    expect(globalCss).toContain('--section-mist: #f7faff;');
    expect(globalCss).toMatch(/\.hero\s*\{[^}]*max-width:\s*none;[^}]*margin:\s*0;[^}]*background:\s*linear-gradient\(180deg,\s*#f7faff 0%,\s*#fff 92%\);/s);
    expect(globalCss).toMatch(/\.hero-inner\s*\{[^}]*max-width:\s*1240px;[^}]*margin:\s*0 auto;[^}]*display:\s*grid;/s);
    expect(globalCss).toMatch(/\.process-section\s*\{[^}]*background:\s*var\(--section-cream\);/s);
    expect(globalCss).toMatch(/\.features-section\s*\{[^}]*background:\s*var\(--section-white\);/s);
    expect(globalCss).toMatch(/\.standards-section\s*\{[^}]*background:\s*var\(--section-mist\);/s);
    expect(globalCss).toMatch(/\.guides-section\s*\{[^}]*background:\s*var\(--section-cream\);/s);
    expect(globalCss).toMatch(/\.faq-section\s*\{[^}]*background:\s*var\(--section-mist\);/s);
    expect(homePage).toContain('<div class="hero-inner">');
    expect(landingPage).toContain('<div class="hero-inner">');
  });

  it('extends the mockup language to blog and legal templates', () => {
    expect(globalCss).toMatch(/\.blog-hero, \.article-header, \.legal-page\s*\{[^}]*background:\s*var\(--section-mist\);/s);
    expect(globalCss).toMatch(/\.blog-list article\s*\{[^}]*border-radius:\s*20px;/s);
    expect(globalCss).toMatch(/\.article-body, \.legal-body\s*\{[^}]*background:\s*var\(--card\);/s);
    expect(globalCss).toMatch(/\.site-footer\s*\{[^}]*max-width:\s*none;[^}]*border-radius:\s*0;/s);
  });
});
