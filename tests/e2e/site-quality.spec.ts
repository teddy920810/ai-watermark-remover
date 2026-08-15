import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('critical public routes and SEO files are available', async ({ page, request }) => {
  for (const path of ['/', '/blog/', '/watermark-remover/', '/privacy/', '/robots.txt', '/sitemap.xml']) {
    const response = await request.get(path);
    expect(response.ok(), `${path} should be available`).toBeTruthy();
  }

  await page.goto('/');
  await expect(page).toHaveTitle(/Watermark Remover/i);
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', 'http://127.0.0.1:4321/');
});

test('home page has no serious accessibility violations', async ({ page }) => {
  await page.goto('/');
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
