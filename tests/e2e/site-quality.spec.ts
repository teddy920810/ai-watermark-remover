import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';

test('critical public routes and SEO files are available', async ({ page, request }) => {
  for (const path of ['/', '/blog', '/privacy', '/robots.txt', '/sitemap.xml']) {
    const response = await request.get(path);
    expect(response.ok(), `${path} should be available`).toBeTruthy();
  }
  await page.goto('/');
  await expect(page).toHaveTitle(/\S/);
  const canonicalHref = await page.locator('link[rel=canonical]').getAttribute('href');
  expect(canonicalHref).toBeTruthy();
  const canonical = new URL(canonicalHref!);
  expect(canonical.protocol).toBe('https:');
  expect(canonical.pathname).toBe('/');

  const sitemapResponse = await request.get('/sitemap.xml');
  const sitemap = await sitemapResponse.text();
  expect(sitemap).toContain('<urlset');
  expect(sitemap).toContain(`<loc>${new URL('/blog', canonical).toString()}</loc>`);
  expect(sitemap).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  expect(sitemap).toMatch(/<changefreq>[a-z]+<\/changefreq>/);
  expect(sitemap).toMatch(/<priority>\d\.\d<\/priority>/);
  expect(sitemap).not.toContain('sitemap-index.xml');
});

test('mobile visitors can open navigation and a dropdown', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'networkidle' });

  const menuButton = page.locator('[data-mobile-menu-toggle]');
  await menuButton.click();
  await expect(menuButton).toHaveAttribute('aria-expanded', 'true');

  const dropdown = page.locator('[data-nav-dropdown-trigger]').first();
  await dropdown.click();
  await expect(dropdown).toHaveAttribute('aria-expanded', 'true');
  await expect(dropdown.locator('xpath=..').locator('a').first()).toBeVisible();
});

test('all public content routes and 404 have one H1 and no serious accessibility violations', async ({ page, request }) => {
  test.setTimeout(60_000);
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
  expect(request.url()).toMatch(/[?&]tid=G-[A-Z0-9]+/);
});


test('homepage exposes the features and FAQ sections in CMS-managed order', async ({ page }) => {
  await page.goto('/');

  const featuresHeading = page.getByRole('heading', { name: /A Free Online Watermark Remover/i, level: 2 });
  await expect(featuresHeading).toBeVisible();
  await expect(featuresHeading.locator('xpath=ancestor::section')).toHaveAttribute('aria-labelledby', 'features-heading');

  const featureItems = featuresHeading.locator('xpath=ancestor::section').locator('.feature-item');
  await expect(featureItems).toHaveCount(3);

  const faqHeading = page.getByRole('heading', { name: /Image Watermark Remover FAQs/i, level: 2 });
  await expect(faqHeading).toBeVisible();
  await expect(faqHeading.locator('xpath=ancestor::section')).toHaveAttribute('aria-labelledby', 'faq-heading');
  const faqEntries = faqHeading.locator('xpath=ancestor::section').locator('details');
  await expect(faqEntries.first()).toContainText('WatermarkGemini');
});

test('FAQ section emits a FAQPage JSON-LD schema', async ({ page }) => {
  await page.goto('/');
  const schemas = await page.locator('script[type="application/ld+json"]').allTextContents();
  const matched = schemas.some((raw) => {
    try {
      const parsed = JSON.parse(raw);
      return parsed['@type'] === 'FAQPage' && Array.isArray(parsed.mainEntity) && parsed.mainEntity.length > 0;
    } catch {
      return false;
    }
  });
  expect(matched).toBe(true);
});

test('tool landing pages render their own usage steps and FAQ sections', async ({ page }) => {
  const contentDirectory = new URL('../../src/content/landing-pages/', import.meta.url);
  const pages = readdirSync(contentDirectory, { encoding: 'utf8' }).filter((fileName) => fileName.endsWith('.json')).map((fileName) => {
    const content = JSON.parse(
      readFileSync(new URL(fileName, contentDirectory), 'utf8'),
    );
    return { path: `/${content.slug}`, faqHeading: content.faq.heading as string };
  });
  expect(new Set(pages.map(({ faqHeading }) => faqHeading)).size).toBe(pages.length);

  for (const { path, faqHeading } of pages) {
    await page.goto(path);
    const process = page.locator('#how-it-works');
    await expect(process.getByRole('heading', { level: 2 })).toBeVisible();
    await expect(process.locator('.section-heading > p')).toBeVisible();
    await expect(process.locator('.steps article')).toHaveCount(3);

    const faq = page.locator('.faq-section');
    await expect(faq.getByRole('heading', { level: 2 })).toHaveText(faqHeading);
    await expect(faq.locator('.section-heading > p')).toBeVisible();
    await expect(faq.locator('details').first()).toBeVisible();
  }
});
