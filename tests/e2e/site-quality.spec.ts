import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('critical public routes and SEO files are available', async ({ page, request }) => {
  for (const path of ['/', '/blog', '/privacy', '/robots.txt', '/sitemap.xml']) {
    const response = await request.get(path);
    expect(response.ok(), `${path} should be available`).toBeTruthy();
  }
  await page.goto('/');
  await expect(page).toHaveTitle(/Watermark Remover/i);
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', 'https://www.watermarkgemini.com/');

  const sitemapResponse = await request.get('/sitemap.xml');
  const sitemap = await sitemapResponse.text();
  expect(sitemap).toContain('<urlset');
  expect(sitemap).toContain('<loc>https://www.watermarkgemini.com/blog</loc>');
  expect(sitemap).toContain('<lastmod>2026-08-15</lastmod>');
  expect(sitemap).toContain('<changefreq>weekly</changefreq>');
  expect(sitemap).toContain('<priority>1.0</priority>');
  expect(sitemap).not.toContain('sitemap-index.xml');
});

test('mobile visitors can open navigation and a dropdown', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  const menuButton = page.locator('[data-mobile-menu-toggle]');
  await menuButton.click();
  await expect(menuButton).toHaveAttribute('aria-expanded', 'true');

  const dropdown = page.getByRole('button', { name: /AI Watermark Remover/i });
  await dropdown.click();
  await expect(dropdown).toHaveAttribute('aria-expanded', 'true');
  await expect(dropdown.locator('xpath=..').locator('a').first()).toBeVisible();
});

test('all public content routes and 404 have one H1 and no serious accessibility violations', async ({ page, request }) => {
  const sitemap = await (await request.get('/sitemap.xml')).text();
  const routes = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]).pathname);
  routes.push('/missing-page-for-404-check');

  for (const route of routes) {
    const response = await page.goto(route, { waitUntil: 'networkidle' });
    expect(response?.status(), `${route} should return its expected status`).toBe(route.includes('missing-page') ? 404 : 200);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('main h1'), `${route} should have exactly one content H1`).toHaveCount(1);
    if (route.includes('missing-page')) {
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow');
    }
    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? '')),
      `${route} should have no serious accessibility violations`,
    ).toEqual([]);
  }
});

test('Google tag emits a page_view collection request', async ({ page }) => {
  await page.route('**/g/collect**', (route) => route.fulfill({ status: 204 }));
  const pageView = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname.endsWith('/g/collect') && url.searchParams.get('en') === 'page_view';
  }, { timeout: 15_000 });

  await page.goto('/');
  const request = await pageView;
  expect(request.url()).toContain('tid=G-52ZWCGEZ7R');
});


