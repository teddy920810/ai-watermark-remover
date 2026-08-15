import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layoutSource = readFileSync(new URL('./SiteLayout.astro', import.meta.url), 'utf8');

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
});
