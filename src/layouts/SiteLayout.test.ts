import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layoutSource = readFileSync(new URL('./SiteLayout.astro', import.meta.url), 'utf8');
const globalCss = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');
const uploaderSource = readFileSync(new URL('../components/uploader/ImageUploader.tsx', import.meta.url), 'utf8');
const popupSource = readFileSync(new URL('../pages/auth/popup.astro', import.meta.url), 'utf8');

describe('SiteLayout Google Analytics integration', () => {
  it('loads and configures the requested GA4 measurement ID once', () => {
    expect(layoutSource).toContain('https://www.googletagmanager.com/gtag/js?id=G-52ZWCGEZ7R');
    expect(layoutSource).toContain("gtag('config', 'G-52ZWCGEZ7R')");
    expect(layoutSource.match(/gtag\('config', 'G-52ZWCGEZ7R'\)/g)).toHaveLength(1);
    expect(layoutSource).not.toContain('G-WPF5GVC931');
  });

  it('queues commands with the official Google tag arguments object', () => {
    expect(layoutSource).toContain('function gtag(){dataLayer.push(arguments);}');
    expect(layoutSource).not.toContain('function gtag(...args)');
  });

  it('renders CMS navigation children as a hover and keyboard dropdown', () => {
    expect(layoutSource).toContain('(item.children?.length ?? 0) > 0');
    expect(layoutSource).toContain('class="nav-dropdown"');
    expect(layoutSource).toContain('class="nav-dropdown-trigger"');
    expect(layoutSource).toContain('(item.children ?? []).map');
    expect(globalCss).toContain('.nav-dropdown:hover .nav-dropdown-panel');
    expect(globalCss).toContain('.nav-dropdown:has(:focus-visible) .nav-dropdown-panel');
    expect(globalCss).toContain('pointer-events: none');
    expect(globalCss).toContain('.site-header nav > a, .nav-dropdown-trigger { font-weight: 750; }');
    expect(globalCss).not.toMatch(/\.nav-dropdown-trigger\s*\{[^}]*font:\s*inherit/);
  });

  it('renders every brand mark as the CMS-managed logo image', () => {
    const brandSources = [layoutSource, uploaderSource, popupSource].join('\n');
    expect(brandSources).not.toContain('brand-mark');
    expect(layoutSource.match(/<img class="brand-logo"/g)).toHaveLength(2);
    expect(uploaderSource).toContain('<img className="brand-logo auth-logo"');
    expect(popupSource).toContain('<img class="brand-logo"');
  });

  it('provides an accessible mobile navigation toggle and dropdown state', () => {
    expect(layoutSource).toContain('data-mobile-menu-toggle');
    expect(layoutSource).toContain('aria-controls="site-navigation"');
    expect(layoutSource).toContain('aria-expanded="false"');
    expect(layoutSource).toContain('data-nav-dropdown-trigger');
    expect(layoutSource).toContain("event.key === 'Escape'");
    expect(globalCss).toContain('.site-header.is-menu-open nav');
    expect(globalCss).toContain('.nav-dropdown.is-open .nav-dropdown-panel');
  });

  it('lets the browser infer the CMS favicon media type', () => {
    expect(layoutSource).toContain('<link rel="icon" href={site.favicon} />');
    expect(layoutSource).not.toContain('type="image/svg+xml"');
  });
});

