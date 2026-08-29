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

test('blog tables scroll inside the article without widening the mobile page', async ({ page }) => {
  const contentDirectory = new URL('../../src/content/blog/', import.meta.url);
  const routes = readdirSync(contentDirectory, { encoding: 'utf8' })
    .filter((fileName) => fileName.endsWith('.md'))
    .map((fileName) => `/blog/${fileName.replace(/\.md$/, '')}`);
  await page.setViewportSize({ width: 390, height: 844 });

  for (const route of routes) {
    await page.goto(route, { waitUntil: 'networkidle' });
    await expect(page.locator('article')).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      overflowing: [...document.querySelectorAll<HTMLElement>('body *')]
        .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth)
        .slice(0, 5)
        .map((element) => ({
          className: element.className,
          right: Math.round(element.getBoundingClientRect().right),
          tagName: element.tagName,
        })),
    }));
    expect(
      dimensions.scrollWidth,
      `${route} should not widen the mobile page: ${JSON.stringify(dimensions.overflowing)}`,
    ).toBeLessThanOrEqual(dimensions.clientWidth);
    for (const table of await page.locator('.article-body table').all()) {
      expect(await table.evaluate((element) => getComputedStyle(element).overflowX)).toBe('auto');
    }
  }
});

test('article navigation and related guides flank the story on desktop and stack on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/blog/how-to-remove-watermarks-responsibly', { waitUntil: 'networkidle' });

  const tableOfContents = page.getByRole('navigation', { name: 'On this page' });
  const article = page.locator('.article-main');
  const relatedGuides = page.getByRole('complementary', { name: 'Related guides' });
  await expect(tableOfContents.getByRole('link').first()).toHaveAttribute('href', /^#[a-z0-9-]+$/);
  await expect(relatedGuides.getByRole('link')).toHaveCount(4);

  const desktopBoxes = await Promise.all([
    tableOfContents.boundingBox(),
    article.boundingBox(),
    relatedGuides.boundingBox(),
  ]);
  expect(desktopBoxes.every(Boolean)).toBe(true);
  expect(desktopBoxes[0]!.x + desktopBoxes[0]!.width).toBeLessThan(desktopBoxes[1]!.x);
  expect(desktopBoxes[2]!.x).toBeGreaterThan(desktopBoxes[1]!.x + desktopBoxes[1]!.width);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileBoxes = await Promise.all([
    page.locator('.article-toc').boundingBox(),
    article.boundingBox(),
    relatedGuides.boundingBox(),
  ]);
  expect(mobileBoxes.every(Boolean)).toBe(true);
  expect(mobileBoxes[0]!.y + mobileBoxes[0]!.height).toBeLessThanOrEqual(mobileBoxes[1]!.y);
  expect(mobileBoxes[2]!.y).toBeGreaterThanOrEqual(mobileBoxes[1]!.y + mobileBoxes[1]!.height);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.article-layout')).toHaveCount(0);
});

test('all public content routes and 404 have one H1 and no serious accessibility violations', async ({ page, request }) => {
  test.setTimeout(240_000);
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

test('homepage reference controls, tools, highlighted headings, and guide lists work together', async ({ page }) => {
  await page.goto('/');

  const results = page.locator('[data-scenario-section]');
  const tabs = results.getByRole('tab');
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await results.getByRole('button', { name: 'Next scenario' }).click();
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await results.getByRole('button', { name: 'Previous scenario' }).click();
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');

  const toolCards = page.locator('.removal-grid .removal-card');
  await expect(toolCards).toHaveCount(6);
  for (const card of await toolCards.all()) {
    await expect(card).toHaveAttribute('href', /^\/[a-z0-9-]+$/);
  }

  await expect(page.locator('.section-heading h2 em')).toHaveCount(6);
  await expect(page.locator('.standards-section h2 em')).toHaveCount(1);
  await expect(page.locator('.guides-list-grid .guides-list')).toHaveCount(2);
  await expect(page.locator('.guides-list-grid li')).toHaveCount(6);
  await expect(page.locator('.standards-card > div')).toHaveCount(4);
});

test('homepage CMS PNG and JPEG images load generated responsive WebP variants', async ({ page }) => {
  await page.goto('/');

  const results = page.locator('[data-scenario-section]');
  const panels = results.locator('[data-scenario-panel]');
  await expect(panels).toHaveCount(3);

  for (let index = 0; index < await panels.count(); index += 1) {
    await results.getByRole('tab').nth(index).click();
    const image = panels.nth(index).locator('img');
    await image.scrollIntoViewIfNeeded();
    await expect(image.locator('xpath=..')).toHaveJSProperty('tagName', 'PICTURE');
    await expect(image.locator('xpath=..').locator('source[type="image/webp"]')).toHaveAttribute(
      'srcset',
      /\/generated\/uploads\/.*\.(?:png|jpe?g)-\d+\.webp \d+w/i,
    );
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).currentSrc)).toMatch(/\/generated\/uploads\/.*\.webp$/i);
    await expect(image).toHaveAttribute('src', /\/uploads\/.*\.(?:png|jpe?g)$/i);
  }
});

test('missing and failed images use the site-wide placeholder without broken markup', async ({ page }) => {
  await page.goto('/remove-logo-from-image');

  const missingFeature = page.getByRole('heading', { name: 'AI Logo Remover for Detailed Product Surfaces' })
    .locator('xpath=ancestor::article')
    .locator('img');
  await expect(missingFeature).toHaveAttribute('src', '/images/image-placeholder.svg');
  await expect(missingFeature).toHaveAttribute('data-image-fallback', 'true');

  await page.route('**/uploads/watermarkgemini-logo.svg', (route) => route.abort());
  await page.reload();
  const logo = page.locator('.site-header .brand-logo');
  await expect(logo).toHaveAttribute('src', '/images/image-placeholder.svg');
  await expect(logo).toHaveAttribute('data-image-fallback', 'true');
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
