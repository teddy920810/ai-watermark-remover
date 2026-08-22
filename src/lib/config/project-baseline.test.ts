import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readProjectFile = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

describe('project baseline configuration', () => {
  it('uses the Astro development origin for imported Google OAuth credentials', () => {
    const importer = readProjectFile('scripts/import-google-credentials.mjs');
    const guide = readProjectFile('docs/DEVELOPER_GUIDE.md');
    expect(importer).toContain("BETTER_AUTH_URL', 'http://localhost:4321'");
    expect(importer).toContain('http://localhost:4321/api/auth/callback/google');
    expect(guide).toContain('http://localhost:4321/api/auth/callback/google');
    expect(importer).not.toContain('localhost:3000');
  });

  it('does not register the chunked Astro sitemap integration', () => {
    const astroConfig = readProjectFile('astro.config.mjs');
    const packageJson = JSON.parse(readProjectFile('package.json')) as { dependencies: Record<string, string> };
    expect(astroConfig).not.toContain("from '@astrojs/sitemap'");
    expect(astroConfig).not.toContain('sitemap()');
    expect(packageJson.dependencies).not.toHaveProperty('@astrojs/sitemap');
  });

  it('audits every public sitemap route and the 404 page for accessibility and heading structure', () => {
    const e2e = readProjectFile('tests/e2e/site-quality.spec.ts');
    expect(e2e).toContain("request.get('/sitemap.xml')");
    expect(e2e).toContain("routes.push('/missing-page-for-404-check')");
    expect(e2e).toContain("page.locator('main h1')");
    expect(e2e).toContain('new AxeBuilder({ page }).analyze()');
  });

  it('runs Playwright against an isolated project-owned development server', () => {
    const playwright = readProjectFile('playwright.config.ts');
    expect(playwright).toContain("const e2eOrigin = 'http://127.0.0.1:4379'");
    expect(playwright).toContain('reuseExistingServer: false');
    expect(playwright).toContain('baseURL: e2eOrigin');
    expect(playwright).toContain("SITE_URL: e2eOrigin");
    expect(playwright).toContain("ASTRO_DEV_BACKGROUND: '1'");
  });

  it('ships compatible security headers with CSP in report-only mode', () => {
    const vercel = JSON.parse(readProjectFile('vercel.json')) as {
      headers: Array<{ headers: Array<{ key: string; value: string }> }>;
    };
    const headers = Object.fromEntries(vercel.headers[0]!.headers.map(({ key, value }) => [key, value]));
    expect(headers['Content-Security-Policy-Report-Only']).toContain("default-src 'self'");
    expect(headers['Content-Security-Policy-Report-Only']).toContain('https://www.googletagmanager.com');
    expect(headers['Content-Security-Policy-Report-Only']).toContain('https://*.r2.cloudflarestorage.com');
    expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin-allow-popups');
    expect(headers['Strict-Transport-Security']).toContain('max-age=63072000');
  });

  it('cancels stale CI runs, audits dependencies, and retains E2E failure evidence', () => {
    const workflow = readProjectFile('.github/workflows/ci.yml');
    const packageJson = JSON.parse(readProjectFile('package.json')) as { scripts: Record<string, string> };
    expect(workflow).toContain('cancel-in-progress: true');
    expect(workflow).toContain('npm run audit:dependencies');
    expect(workflow).toContain('actions/upload-artifact@v4');
    expect(workflow).toContain('if: failure()');
    expect(workflow).toContain('test-results/');
    expect(packageJson.scripts['audit:dependencies']).toBe('npm audit --audit-level=high');
  });
});

