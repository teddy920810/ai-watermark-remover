import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

async function openPublicPage(page: Page, path: string) {
  // Public readiness is visible HTML plus the usable launcher, not dev-audit/analytics silence.
  const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('.site-header')).toBeVisible();
  const launcher = page.getByTestId('media-launcher-file');
  if (await launcher.count()) await expect(launcher).toBeEnabled();
  await page.evaluate(() => document.fonts.ready);
  return response;
}

test('ChatGPT landing modules keep source visuals and page-local actions without changing other pages', async ({ page }) => {
  await page.goto('/chatgpt-watermark-remover');
  await expect(page.locator('.landing-features-section .feature-item')).toHaveCount(3);
  await expect(page.locator('.faq-list details')).toHaveCount(6);
  await expect(page.locator('.tool-landing > section')).toHaveCount(7);
  await expect(page.locator('.tool-landing > section').nth(3)).toHaveAttribute('id', 'image-requirements');
  for (const image of await page.locator('.landing-features-section img').all()) {
    await image.scrollIntoViewIfNeeded();
    await expect(image).toHaveAttribute('src', /\/uploads\/chatgpt-feature-/);
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
  await page.locator('.hero-actions').getByRole('link', { name: 'Review image requirements' }).click();
  await expect(page).toHaveURL(/#image-requirements$/);
  const footer = page.locator('.site-cta'); await footer.scrollIntoViewIfNeeded();
  const fileChooser = page.waitForEvent('filechooser');
  await footer.getByRole('button', { name: 'Upload file', exact: true }).click();
  await (await fileChooser).setFiles([]);
  await expect(page).toHaveURL(/\/chatgpt-watermark-remover#image-requirements$/);
  await expect(page.locator('.site-cta h2')).toHaveText('Ready to Review an Authorized Image?');
  await page.goto('/remove-text-from-image');
  await expect(page.locator('#image-requirements')).toHaveCount(0);
  const textPage = JSON.parse(readFileSync(new URL('../../src/content/landing-pages/remove-text-from-image.json', import.meta.url), 'utf8'));
  const site = JSON.parse(readFileSync(new URL('../../src/content/settings/site.json', import.meta.url), 'utf8'));
  await expect(page.locator('.site-cta h2')).toHaveText(textPage.cta?.heading ?? site.cta.heading);
  await expect(page.locator('.site-cta > div > p')).toHaveText(textPage.cta?.description ?? site.cta.description);
});

test('all tools remain reachable in the desktop and mobile header with honest availability labels', async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/chatgpt-watermark-remover');
    if (width === 390) await page.locator('[data-mobile-menu-toggle]').click();
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await nav.getByRole('button', { name: 'Video & Batch Tools' }).click();
    await expect(nav.locator('.nav-status-badge')).toHaveCount(9);
    await expect(nav.getByRole('link', { name: 'Video Watermark Remover', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'All Watermark Tools' })).toHaveCount(0);
    const lastTool = nav.getByRole('link', { name: 'Batch Watermark Remover Coming Soon', exact: true });
    await lastTool.scrollIntoViewIfNeeded();
    await expect(lastTool).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await lastTool.click();
    await expect(page).toHaveURL(/\/batch-watermark-remover$/);
    await expect(page.locator('.hero-status-badge')).toHaveText('Coming Soon');
  }
});

for (const width of [1440, 390]) test(`keyboard closes the navigation and returns visible focus at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await page.goto('/video-watermark-remover');
  await page.mouse.move(width - 5, 830);
  const nav = page.locator('#site-navigation');
  const menu = page.getByRole('button', { name: 'Open navigation' });
  if (width === 390) { await menu.focus(); await page.keyboard.press('Space'); }
  const trigger = nav.locator('[data-nav-dropdown-trigger]').filter({ hasText: 'Video & Batch Tools' });
  await trigger.focus(); await page.keyboard.press('Enter');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const video = nav.getByRole('link', { name: 'Video Watermark Remover', exact: true });
  await expect(video).toBeVisible();
  await page.keyboard.press('Tab'); await expect(video).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(video).toBeHidden();
  if (width === 390) {
    await expect(menu).toBeFocused(); await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Space'); await trigger.focus();
  } else await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(video).toBeVisible();
  await page.keyboard.press('Tab'); await expect(video).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(nav.getByRole('link', { name: 'Sora Watermark Remover Coming Soon', exact: true })).toBeFocused();
  await page.mouse.click(width - 5, 830);
  await expect(video).toBeHidden();
});

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
  await openPublicPage(page, '/');

  const menuButton = page.locator('[data-mobile-menu-toggle]');
  await menuButton.click();
  await expect(menuButton).toHaveAttribute('aria-expanded', 'true');

  const dropdown = page.locator('[data-nav-dropdown-trigger]').first();
  await dropdown.click();
  await expect(dropdown).toHaveAttribute('aria-expanded', 'true');
  await expect(dropdown.locator('xpath=..').locator('a').first()).toBeVisible();
});

test.describe('blog tables scroll inside the article without widening the mobile page', () => {
  const contentDirectory = new URL('../../src/content/blog/', import.meta.url);
  const routes = readdirSync(contentDirectory, { encoding: 'utf8' })
    .filter((fileName) => fileName.endsWith('.md'))
    .filter((fileName) => !/^draft:\s*true\s*$/m.test(readFileSync(new URL(fileName, contentDirectory), 'utf8')))
    .map((fileName) => `/blog/${fileName.replace(/\.md$/, '')}`);
  for (const route of routes) {
    test(route, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await openPublicPage(page, route);
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
    });
  }
});

test('article navigation and related guides flank the story on desktop and stack on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openPublicPage(page, '/blog/how-to-remove-watermarks-responsibly');

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
    const response = await openPublicPage(page, route);
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

  const featuresHeading = page.getByRole('heading', { name: /Remove Watermarks Cleanly with AI/i, level: 2 });
  await expect(featuresHeading).toBeVisible();
  await expect(featuresHeading.locator('xpath=ancestor::section')).toHaveAttribute('aria-labelledby', 'features-heading');

  const featureItems = featuresHeading.locator('xpath=ancestor::section').locator('.feature-item');
  await expect(featureItems).toHaveCount(4);

  const faqHeading = page.getByRole('heading', { name: /Image Watermark Remover FAQs/i, level: 2 });
  await expect(faqHeading).toBeVisible();
  await expect(faqHeading.locator('xpath=ancestor::section')).toHaveAttribute('aria-labelledby', 'faq-heading');
  const faqEntries = faqHeading.locator('xpath=ancestor::section').locator('details');
  await expect(faqEntries.first()).toContainText('WatermarkGemini');
});

test('homepage blueprint previews, CTA routes and motion controls work on desktop and mobile', async ({ page }) => {
  let processingRequests = 0;
  await page.route('**/api/jobs', route => { processingRequests++; return route.abort(); });
  for (const width of [1920, 390]) {
    await page.setViewportSize({width, height:900});
    await openPublicPage(page, '/');
    await expect(page.locator('[data-hero-preview]:visible')).toHaveCount(1);
    await page.locator('[data-hero-sample]').nth(1).click();
    await expect(page.locator('[data-hero-sample]').nth(1)).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('[data-hero-preview]:visible input[type=range]')).toHaveCount(0);
    const tabs=page.locator('[data-scenario-tab]');
    await tabs.first().focus();
    await tabs.first().press('End');
    await expect(tabs.last()).toHaveAttribute('aria-selected','true');
    const scenarioAction = page.locator('[data-scenario-panel]:visible');
    await scenarioAction.scrollIntoViewIfNeeded();
    await expect(scenarioAction.getByRole('button', { name: 'Upload file', exact: true })).toBeEnabled();
    await expect(scenarioAction.locator('input[type=file]')).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp,video/mp4');
    await page.locator('[data-reviews-toggle]').click();
    await expect(page.locator('[data-reviews-marquee]')).toHaveClass(/is-paused/);
    await expect(page.locator('.audience-grid article')).toHaveCount(3);
    await expect(page.locator('.live-removal-grid a')).toHaveCount(8);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.locator('.live-removal-grid a').first().click();
    await expect(page).toHaveURL(/\/remove-background$/);
    await expect(page.locator('.home-blueprint')).toHaveCount(0);
  }
  expect(processingRequests).toBe(0);
});

test('homepage matches blueprint geometry and keeps mobile comparisons and active tabs in view', async ({ page }) => {
  await page.setViewportSize({ width:1920, height:1080 });
  await openPublicPage(page, '/');
  const layout = await page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector)!;
      const { x,y,width,height } = element.getBoundingClientRect();
      return { x,y,width,height };
    };
    return {
      tabs:rect('.result-tabs'),
      stepGrid:rect('.steps'),
      feature:rect('.feature-media .image-display'),
      audiences:rect('.audience-grid'),
      tools:rect('.live-removal-grid'),
      headingSize:getComputedStyle(document.querySelector('.features-section h2')!).fontSize,
      note:rect('.illustration-note'),
      trust:rect('.trust-list'),
    };
  });
  expect(layout.tabs.width).toBeCloseTo(1200,0);
  expect(layout.stepGrid.width).toBeCloseTo(1200,0);
  expect(layout.feature.width).toBeCloseTo(540,0);
  expect(layout.feature.height).toBeGreaterThan(0);
  expect(layout.audiences.width).toBeCloseTo(1280,0);
  expect(layout.tools.x).toBeCloseTo((1920-1200)/2,0);
  expect(layout.headingSize).toBe('40px');
  expect(layout.note.y+layout.note.height).toBeLessThanOrEqual(layout.trust.y);

  await page.setViewportSize({ width:390,height:844 });
  const tabs=page.locator('[data-scenario-tab]');
  await tabs.first().focus();
  await tabs.first().press('End');
  const mobile=await page.evaluate(()=>{
    const rect=(selector:string)=>document.querySelector(selector)!.getBoundingClientRect();
    const stage=rect('[data-scenario-panel]:not([hidden]) .image-display');
    const section=rect('.results-section');
    const tab=rect('[data-scenario-tab][aria-selected=true]');
    const tablist=rect('.result-tabs');
    const evenRow=document.querySelectorAll('.feature-item')[1];
    const note=rect('.illustration-note');
    return {noteBottom:note.bottom,uploadBottom:rect('.upload-panel').bottom,compareTop:rect('.compare-panel').top,trustTop:rect('.trust-list').top,toolWidth:rect('.live-removal-grid .tool-card').width,stage:{left:stage.left,right:stage.right,width:stage.width},section:{left:section.left,right:section.right},tab:{left:tab.left,right:tab.right},tablist:{left:tablist.left,right:tablist.right},mediaY:evenRow.querySelector('.feature-media')!.getBoundingClientRect().y,copyY:evenRow.querySelector('.feature-copy')!.getBoundingClientRect().y};
  });
  expect(mobile.stage.left).toBeGreaterThanOrEqual(mobile.section.left+19);
  expect(mobile.stage.right).toBeLessThanOrEqual(mobile.section.right-19);
  expect(mobile.tab.left).toBeGreaterThanOrEqual(mobile.tablist.left-1);
  expect(mobile.tab.right).toBeLessThanOrEqual(mobile.tablist.right+1);
  expect(mobile.mediaY).toBeLessThan(mobile.copyY);
  expect(mobile.toolWidth).toBeLessThanOrEqual(350);
  expect(mobile.uploadBottom).toBeLessThanOrEqual(mobile.compareTop);
  expect(mobile.noteBottom).toBeLessThanOrEqual(mobile.trustTop);
});

test('homepage single images switch without showing comparison controls or labels', async ({ page }) => {
  await page.goto('/');
  for (const button of await page.locator('[data-hero-sample]').all()) {
    await button.click(); await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-hero-preview]:visible')).toHaveCount(1);
    await expect(page.locator('[data-hero-preview]:visible input[type=range]')).toHaveCount(0);
  }
  await page.locator('[data-scenario-direction=next]:visible').click();
  await expect(page.locator('[data-scenario-panel]:visible [data-image-display]')).toBeVisible();
  await expect(page.locator('[data-scenario-panel]:visible input[type=range],.fixed-watermark,.home-demo-watermark')).toHaveCount(0);
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
  await expect(toolCards).toHaveCount(8);
  for (const card of await toolCards.all()) {
    await expect(card).toHaveAttribute('href', /^\/(?:[a-z0-9-]+|#tool)$/);
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
  await expect(panels).toHaveCount(5);

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

test('original missing content keeps its fallback and network failures use the site-wide placeholder', async ({ page }) => {
  const content = JSON.parse(readFileSync(new URL('../../src/content/landing-pages/remove-logo-from-image.json', import.meta.url), 'utf8'));
  const items = content.features.items.filter((item: { enabled?: boolean }) => item.enabled !== false);
  const writes: string[] = [];
  await page.route(/\/api\/(?:v1\/)?(?:uploads?|upload-url|quotes|jobs)(?:\/|\?|$)/, route => {
    if (route.request().method() === 'GET') return route.continue();
    writes.push(new URL(route.request().url()).pathname); return route.abort();
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/remove-logo-from-image');
    const features = page.locator('.landing-features-section .feature-item');
    await expect(features).toHaveCount(items.length);
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const feature = features.nth(index);
      await expect(feature.getByRole('heading', { level: 3 })).toHaveText(item.heading);
      const display = feature.locator('[data-image-display]');
      await display.scrollIntoViewIfNeeded();
      const legacyAfter = item.comparison?.image || item.image;
      const legacyPair = item.comparison?.beforeImage && item.comparison.beforeImage !== legacyAfter;
      const beforeSource = item.afterImage ? item.image || item.comparison?.image : legacyPair ? item.comparison.beforeImage : item.image || item.comparison?.image;
      const afterSource = item.afterImage || (legacyPair ? legacyAfter : undefined);
      const sources = [['before', beforeSource], ...(afterSource ? [['after', afterSource]] : [])];
      await expect(display.locator('img')).toHaveCount(sources.length);
      for (const [side, source] of sources) {
        expect(source).toMatch(/^\/uploads\//);
        const image = display.locator(`[data-image-side="${side}"] img`);
        const present = existsSync(new URL(`../../public${source}`, import.meta.url));
        await expect(image).toHaveAttribute('alt', item.imageAlt);
        await expect(image).toHaveAttribute('src', present ? source : '/images/image-placeholder.svg');
        if (!present) await expect(image).toHaveAttribute('data-image-fallback', 'true');
        await expect.poll(() => image.evaluate(async element => {
          const image = element as HTMLImageElement;
          try { await image.decode(); return image.naturalWidth > 0 && image.naturalHeight > 0; } catch { return false; }
        })).toBe(true);
      }
      await expect(feature.locator('.landing-watermark,.fixed-watermark')).toHaveCount(0);
      if (afterSource) {
        expect(afterSource).not.toBe(beforeSource);
        await expect(display).toHaveAttribute('data-pair', 'true');
        await expect(display).toHaveAttribute('data-ready', 'true');
        await expect(display.locator('.image-display-controls')).toBeVisible();
        await expect(display.getByRole('slider', { name: `Compare before and after: ${item.imageAlt}`, exact: true })).toHaveValue('50');
      } else {
        await expect(display.locator('input[type="range"],.image-display-controls')).toHaveCount(0);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  const failureContent = JSON.parse(readFileSync(new URL('../../src/content/landing-pages/gemini-watermark-remover.json', import.meta.url), 'utf8'));
  const failureItem = failureContent.features.items.find((item: { enabled?: boolean }) => item.enabled !== false);
  const legacyAfter = failureItem.comparison?.image || failureItem.image;
  const legacyPair = failureItem.comparison?.beforeImage && failureItem.comparison.beforeImage !== legacyAfter;
  const expectedBefore = failureItem.afterImage ? failureItem.image || failureItem.comparison?.image : legacyPair ? failureItem.comparison.beforeImage : failureItem.image || failureItem.comparison?.image;
  const expectedAfter = failureItem.afterImage || (legacyPair ? legacyAfter : undefined);
  const expectedPair = Boolean(expectedAfter && expectedAfter !== expectedBefore);
  expect(expectedBefore).toMatch(/^\/uploads\//);
  if (expectedAfter) expect(expectedAfter).not.toBe(expectedBefore);
  await page.goto('/gemini-watermark-remover');
  const validDisplay = page.locator('.landing-features-section .feature-media').first().locator('[data-image-display]');
  const validFeature = validDisplay.locator('[data-image-side="before"] img');
  await expect(validFeature).toHaveAttribute('src', expectedBefore);
  await expect(validFeature).toHaveAttribute('alt', failureItem.imageAlt);
  await validFeature.scrollIntoViewIfNeeded();
  await expect.poll(() => validFeature.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  if (expectedPair) {
    await expect(validDisplay).toHaveAttribute('data-pair', 'true');
    await expect(validDisplay).toHaveAttribute('data-ready', 'true');
    await expect(validDisplay.locator('.image-display-controls')).toBeVisible();
    await expect(validDisplay.locator('input[type="range"]')).toHaveValue('50');
    await expect(validDisplay.locator('[data-image-side="after"] img')).toHaveAttribute('src', expectedAfter);
  } else {
    await expect(validDisplay.locator('input[type="range"],.image-display-controls')).toHaveCount(0);
  }
  // currentSrc selects the fetched responsive resource; only the content above defines the expected media contract.
  const source = await validFeature.evaluate(image => (image as HTMLImageElement).currentSrc);
  await page.route(source, route => route.abort());
  await page.reload();
  await validDisplay.scrollIntoViewIfNeeded();
  await expect(validFeature).toHaveAttribute('src', '/images/image-placeholder.svg');
  await expect(validFeature).toHaveAttribute('data-image-fallback', 'true');
  await expect.poll(() => validFeature.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(validDisplay).toHaveAttribute('data-ready', 'false');
  if (expectedPair) {
    await expect(validDisplay).toHaveAttribute('data-pair', 'true');
    const controls = validDisplay.locator('.image-display-controls');
    const range = validDisplay.locator('input[type="range"]');
    await expect(controls).toHaveCount(1);
    await expect(controls).toBeHidden();
    await expect(range).toHaveCount(1);
    await expect(range).toBeHidden();
    const after = validDisplay.locator('[data-image-side="after"] img');
    await expect(after).toHaveAttribute('src', expectedAfter);
    await expect(after).toHaveAttribute('alt', failureItem.imageAlt);
    await expect(after).not.toHaveAttribute('data-image-fallback', 'true');
    await expect.poll(() => after.evaluate(async element => {
      const image = element as HTMLImageElement;
      try { await image.decode(); return image.complete && image.naturalWidth > 0 && image.naturalHeight > 0; } catch { return false; }
    })).toBe(true);
    await expect(after).toBeVisible();
    await expect(validDisplay.locator('[data-image-side="before"]')).toBeHidden();
  } else {
    await expect(validDisplay).not.toHaveAttribute('data-pair', 'true');
    await expect(validDisplay.locator('input[type="range"],.image-display-controls,[data-image-side="after"]')).toHaveCount(0);
  }

  await page.route('**/uploads/watermarkgemini-logo.svg', (route) => route.abort());
  await page.reload();
  const logo = page.locator('.site-header .brand-logo');
  await expect(logo).toHaveAttribute('src', '/images/image-placeholder.svg');
  await expect(logo).toHaveAttribute('data-image-fallback', 'true');
  expect(writes).toEqual([]);
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
  test.setTimeout(90_000); // Check the independent content on all published tool pages.
  const contentDirectory = new URL('../../src/content/landing-pages/', import.meta.url);
  const pages = readdirSync(contentDirectory, { encoding: 'utf8' }).filter((fileName) => fileName.endsWith('.json')).map((fileName) => {
    const content = JSON.parse(
      readFileSync(new URL(fileName, contentDirectory), 'utf8'),
    );
    return { path: `/${content.slug}`, faqHeading: content.faq.heading as string, faqIntro: content.faq.intro as string, draft: content.draft === true };
  }).filter((content) => !content.draft);
  expect(new Set(pages.map(({ faqHeading }) => faqHeading)).size).toBe(pages.length);

  for (const { path, faqHeading, faqIntro } of pages) {
    await page.goto(path);
    const process = page.locator('#how-it-works');
    await expect(process.getByRole('heading', { level: 2 })).toBeVisible();
    await expect(process.locator('.section-heading > p')).toBeVisible();
    await expect(process.locator('.steps article')).toHaveCount(3);

    const faq = page.locator('.faq-section');
    await expect(faq.getByRole('heading', { level: 2 })).toHaveText(faqHeading);
    await expect(faq.locator('.section-heading > p')).toHaveText(faqIntro);
    await expect(faq.locator('details').first()).toBeVisible();
  }
});
