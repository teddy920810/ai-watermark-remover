import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('critical public routes and SEO files are available', async ({ page, request }) => {
  for (const path of ['/', '/blog/', '/privacy/', '/robots.txt', '/sitemap.xml']) {
    const response = await request.get(path);
    expect(response.ok(), `${path} should be available`).toBeTruthy();
  }

  await page.goto('/');
  await expect(page).toHaveTitle(/Watermark Remover/i);
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', 'http://127.0.0.1:4322/');

  const sitemapResponse = await request.get('/sitemap.xml');
  const sitemap = await sitemapResponse.text();
  expect(sitemap).toContain('<urlset');
  expect(sitemap).toContain('<loc>http://127.0.0.1:4322/blog/</loc>');
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
  await expect(page.getByRole('link', { name: 'Remove text from image' })).toBeVisible();
});

test('home page has no serious accessibility violations', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('main')).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))).toEqual([]);
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


