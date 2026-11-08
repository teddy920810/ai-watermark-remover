import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const globalCss = readFileSync(new URL('../../styles/design-system.css', import.meta.url), 'utf8') + readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');
const homePage = readFileSync(new URL('../../pages/index.astro', import.meta.url), 'utf8');
const landingPage = readFileSync(new URL('../../components/LandingPage.astro', import.meta.url), 'utf8');
const launcherCss = readFileSync(new URL('../../components/launcher/launcher.css', import.meta.url), 'utf8');

// Section presence, tool/guide counts and carousel actions are covered in site-quality.spec.ts;
// image geometry is covered in image-display-frames.spec.ts. Keep distinct visual-token checks here.
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
    expect(launcherCss).toContain('.launcher-drop{');
    expect(launcherCss).toContain('.launcher-drop .button{');
    expect(globalCss).toContain('.steps article {');
    expect(globalCss).toContain('.guide-grid article {');
    expect(globalCss).toContain('.blog-list article {');
    expect(globalCss).toContain('.legal-body {');
  });

  it('keeps shared headings and lower-page spacing aligned with the reference system', () => {
    expect(globalCss).toMatch(/\.steps h3\s*\{[^}]*font:\s*700 19px\/1\.3 var\(--font-display\);/s);
    expect(globalCss).toMatch(/\.feature-copy h3\s*\{[^}]*font:\s*700 clamp\(28px,\s*2\.4vw,\s*39px\)\/1\.18 var\(--font-display\);[^}]*letter-spacing:\s*-1\.5px;/s);
    expect(globalCss).toMatch(/\.feature-copy p\s*\{[^}]*font-size:\s*1rem;[^}]*line-height:\s*1\.65;/s);
    expect(globalCss).toMatch(/\.removal-card h3\s*\{[^}]*font:\s*700 19px\/1\.3 var\(--font-display\);/s);
    expect(globalCss).toMatch(/\.standards-card strong\s*\{[^}]*font:\s*700 16px\/1\.35 var\(--font-display\);/s);
    expect(globalCss).toMatch(/\.faq-list summary\s*\{[^}]*font:\s*700 15px\/1\.45 var\(--font-display\);/s);
    expect(globalCss).toMatch(/\.site-cta\s*\{[^}]*padding:\s*86px max\(32px, calc\(\(100vw - 1320px\) \/ 2\)\);/s);
    expect(globalCss).toMatch(/\.site-cta h2\s*\{[^}]*font:\s*800 clamp\(33px,\s*3vw,\s*47px\)\/1\.16 var\(--font-display\);/s);
    expect(globalCss).toMatch(/\.site-footer\s*\{[^}]*padding:\s*72px max\(32px, calc\(\(100vw - 1320px\) \/ 2\)\) 28px;/s);
    expect(globalCss).toMatch(/\.footer-group h2\s*\{[^}]*font:\s*700 13px\/1\.2 var\(--font-display\);/s);
  });

  it('shows feature artwork at its intrinsic ratio without a framed card treatment', () => {
    expect(globalCss).toMatch(/\.feature-media > \.responsive-picture\s*\{[^}]*width:\s*auto;[^}]*height:\s*auto;[^}]*max-width:\s*100%;/s);
    expect(globalCss).toMatch(/\.feature-media\s*\{[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s);
    expect(globalCss).toMatch(/\.feature-media img\s*\{[^}]*width:\s*auto;[^}]*height:\s*auto;[^}]*object-fit:\s*contain;[^}]*box-shadow:\s*none;/s);
  });

  it('keeps the blue system readable on compact screens', () => {
    expect(globalCss).toContain('@media (max-width: 900px)');
    expect(globalCss).toContain('@media (max-width: 620px)');
    expect(globalCss).toMatch(/@media \(max-width: 620px\)[\s\S]*\.hero h1\s*\{/);
    expect(launcherCss).toMatch(/@media\s*\(max-width:\s*620px\)[\s\S]*\.launcher-drop\s*\{/);
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
