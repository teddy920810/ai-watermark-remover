import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

export async function openPublicPage(page: Page, path: string) {
  // Wait for visible HTML and the launcher while dev audit and analytics continue in the background.
  const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('.site-header')).toBeVisible();
  const launcher = page.getByTestId('media-launcher-file');
  if (await launcher.count()) await expect(launcher).toBeEnabled();
  await page.evaluate(() => document.fonts.ready);
  return response;
}

export function testPublicAccessibility(half: 'odd' | 'even') {
  const batchCount = 8;
  const missingPage = '/missing-page-for-404-check';
  for (let batch = half === 'odd' ? 1 : 2; batch <= batchCount; batch += 2) {
    test(`public routes have one H1 and no serious accessibility violations (${batch}/${batchCount})`, async ({ page, request }) => {
      test.setTimeout(240_000);
      const sitemap = await request.get('/sitemap.xml');
      expect(sitemap.ok()).toBe(true);
      const routes = [...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]).pathname).sort();
      expect(routes.length).toBeGreaterThan(0);
      routes.push(missingPage);

      for (const route of routes.filter((_, index) => index % batchCount === batch - 1)) {
        await test.step(route, async () => {
          const response = await openPublicPage(page, route);
          expect(response?.status()).toBe(route === missingPage ? 404 : 200);
          await expect(page.locator('main h1')).toHaveCount(1);
          if (route === missingPage) {
            await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow');
          }
          const results = await new AxeBuilder({ page }).analyze();
          expect(results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))).toEqual([]);
        });
      }
    });
  }
}
