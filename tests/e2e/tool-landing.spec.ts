import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const sampleImage = {
  name: 'landing-preview.png',
  mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/FZkAAAAASUVORK5CYII=', 'base64'),
};

const videoBytes = readFileSync(new URL('../fixtures/workspace-24fps.mp4', import.meta.url));
const launcherCapabilities = { operations: [
  { operation: 'image-watermark', enabled: true, acceptedTypes: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: 10 * 1024 * 1024 },
  { operation: 'video-watermark', enabled: true, acceptedTypes: ['video/mp4'], maxBytes: 100 * 1024 * 1024, maxDurationSeconds: 540, requiredFps: 24 },
] };

async function anonymousLauncher(page: Page) {
  await page.route('**/api/auth/get-session', route => route.fulfill({ json: null }));
  await page.route('**/api/v1/capabilities', route => route.fulfill({ json: launcherCapabilities }));
  const writes: string[] = [];
  await page.route(/\/api\/(?:v1\/)?(?:uploads?|upload-url|quotes|jobs)(?:\/|\?|$)/, route => {
    if (route.request().method() === 'GET') return route.continue();
    writes.push(new URL(route.request().url()).pathname);
    return route.abort();
  });
  return writes;
}

test('focused tool launchers keep the designed upload target and workspace entry at both viewports', async ({ page }) => {
  test.setTimeout(90_000);
  const writes = await anonymousLauncher(page);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const { route, kind } of [
      { route: '/gemini-watermark-remover', kind: 'image' },
      { route: '/video-watermark-remover', kind: 'video' },
    ]) {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      const launcher = page.locator('.tool-landing #tool .media-launcher');
      await expect(launcher).toHaveAttribute('data-media-launcher', kind);
      const button = launcher.getByRole('button', { name: `Upload ${kind}`, exact: true });
      await expect(button).toBeEnabled();
      await expect(launcher.locator('.launcher-modes')).toBeVisible();
      await expect(launcher.locator('.launcher-modes a[aria-current="page"]')).toHaveText(kind === 'image' ? 'Image' : 'Video');
      await expect(launcher.locator('.launcher-workspace-link')).toHaveAttribute('href', `/app/${kind}`);
      await expect(launcher.locator('.launcher-workspace-link')).toBeVisible();
      const drop = await launcher.locator('.launcher-drop').boundingBox();
      const action = await button.boundingBox();
      expect(drop).not.toBeNull();
      expect(action).not.toBeNull();
      expect(drop!.height).toBeCloseTo(width > 760 ? 396 : 280, 0);
      expect(action!.height).toBeGreaterThanOrEqual(width > 760 ? 72 : 60);
      expect(action!.width).toBeGreaterThanOrEqual(width > 760 ? 258 : 180);
      expect(action!.x).toBeGreaterThan(drop!.x);
      expect(action!.x + action!.width).toBeLessThan(drop!.x + drop!.width);
      expect(await button.evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(15);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
  }
  expect(writes).toEqual([]);
});

test('focused image and video landing entries hand local files to their matching workspace without uploading or charging', async ({ page }) => {
  test.setTimeout(90_000);
  const writes = await anonymousLauncher(page);
  const image = await sharp({ create: { width: 80, height: 60, channels: 3, background: '#bbccaa' } }).png().toBuffer();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/gemini-watermark-remover', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('media-launcher-file')).toBeEnabled();
    await page.getByTestId('media-launcher-file').setInputFiles({ name: 'landing-image.png', mimeType: 'image/png', buffer: image });
    await expect(page).toHaveURL(/\/app\/image$/);
    await expect(page.getByText('landing-image.png', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in to continue', exact: true })).toBeVisible();
    await page.goto('/video-watermark-remover', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('media-launcher-file')).toBeEnabled();
    await expect(page.getByTestId('media-launcher-file')).toHaveAttribute('accept', 'video/mp4');
    await page.getByTestId('media-launcher-file').setInputFiles({ name: 'landing-video.mp4', mimeType: 'video/mp4', buffer: videoBytes });
    await expect(page).toHaveURL(/\/app\/video$/);
    await expect(page.getByText('landing-video.mp4', { exact: true })).toBeVisible();
    await expect(page.locator('video')).toHaveAttribute('src', /^blob:/);
    await expect(page.getByRole('button', { name: 'Sign in to continue', exact: true })).toBeVisible();
  }
  expect(writes).toEqual([]);
});

test('Gemini feature comparisons use the configured clean artwork and clip at both endpoints', async ({ page }) => {
  const content = JSON.parse(readFileSync(new URL('../../src/content/landing-pages/gemini-watermark-remover.json', import.meta.url), 'utf8'));
  for (const width of [1920, 390]) {
    await page.setViewportSize({ width, height: 1080 });
    await page.goto('/gemini-watermark-remover', { waitUntil: 'domcontentloaded' });
    const features = page.locator('.landing-features-section .feature-item');
    await expect(features).toHaveCount(4);
    for (let index = 0; index < 4; index += 1) {
      const feature = features.nth(index);
      const compare = feature.locator('[data-landing-compare]');
      await expect(compare.locator('img').first()).toHaveAttribute('src', content.features.items[index].comparison.image);
      const range = compare.locator('input[type="range"]');
      await range.focus();
      await expect.poll(() => compare.locator('img').first().evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      await range.press('Home');
      await expect(range).toHaveValue('0');
      await expect.poll(() => compare.locator('.landing-watermark').evaluate(overlay => getComputedStyle(overlay).clipPath)).toContain('100%');
      await range.press('End');
      await expect(range).toHaveValue('100');
      await expect.poll(() => compare.locator('.landing-watermark').evaluate(overlay => getComputedStyle(overlay).clipPath)).toBe('inset(0px 0% 0px 0px)');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});

test('landing examples switch and compare on desktop and mobile without creating processing requests', async ({ page }) => {
  let processingRequests = 0;
  await page.route(/\/api\/(?:jobs|upload-url)(?:\?|$)/, route => {
    processingRequests += 1;
    return route.abort();
  });

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/gemini-watermark-remover');
    await expect(page.locator('.tool-landing')).toBeVisible();
    await expect(page.locator('[data-landing-sample]')).toHaveCount(3);
    await expect(page.locator('[data-landing-preview]:visible')).toHaveCount(1);
    const previewImage = page.locator('[data-landing-preview]:visible img').first();
    await expect(previewImage).not.toHaveAttribute('src', /image-placeholder/);
    await expect.poll(() => previewImage.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

    const range = page.locator('[data-landing-preview]:visible input[type="range"]');
    await range.focus();
    await range.press('End');
    await expect(range).toHaveValue('100');
    await expect.poll(() => range.evaluate(element => (element.closest('[data-landing-compare]') as HTMLElement).style.getPropertyValue('--compare-position'))).toBe('100%');
    await range.press('Home');
    await expect(range).toHaveValue('0');
    await expect.poll(() => range.evaluate(element => (element.closest('[data-landing-compare]') as HTMLElement).style.getPropertyValue('--compare-position'))).toBe('0%');

    const bounds = await range.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.move(bounds!.x + bounds!.width * .25, bounds!.y + bounds!.height * .5);
    await page.mouse.down();
    await page.mouse.move(bounds!.x + bounds!.width * .8, bounds!.y + bounds!.height * .5);
    await page.mouse.up();
    expect(Number(await range.inputValue())).toBeGreaterThan(70);

    const secondSample = page.locator('[data-landing-sample]').nth(1);
    await secondSample.click();
    await expect(secondSample).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-landing-sample][aria-pressed="true"]')).toHaveCount(1);
    await expect(page.locator('[data-landing-preview]:visible')).toHaveCount(1);
    await expect(page.locator('[data-landing-preview]:visible input[type="range"]')).toHaveValue('50');
    await expect(page.locator('[data-landing-preview]:visible img').first()).not.toHaveAttribute('src', /image-placeholder/);

    const faq = page.locator('.tool-landing .faq-list details').first();
    await faq.locator('summary').click();
    await expect(faq).toHaveAttribute('open', '');
    await expect(faq.locator('p')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  expect(processingRequests).toBe(0);
});

test('background and object tools retain their full workspace when an image is selected', async ({ page }) => {
  let processingRequests = 0;
  await page.route(/\/api\/(?:jobs|upload-url)(?:\?|$)/, route => {
    processingRequests += 1;
    return route.abort();
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/remove-background', '/remove-object']) {
      await page.goto(route);
      await expect(page.locator('.tool-landing .hero-preview')).toBeVisible();
      await expect(page.locator('#tool astro-island')).not.toHaveAttribute('ssr', '');
      await page.locator('#tool input[type="file"]').setInputFiles(sampleImage);
      await expect(page.locator('.tool-landing .hero-inner')).toHaveClass(/is-tool-expanded/);
      await expect(page.locator('.tool-landing .hero-preview')).toBeHidden();
      await expect(page.locator('#tool img[src^="blob:"]')).toBeVisible();
      if (route === '/remove-object') {
        await expect(page.getByRole('button', { name: 'Brush', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Lasso', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Remove object', exact: true })).toBeDisabled();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.getByRole('button', {
        name: route === '/remove-background' ? 'Choose another' : 'Remove image and start over',
        exact: true,
      }).click();
      await expect(page.locator('.tool-landing .hero-inner')).not.toHaveClass(/is-tool-expanded/);
      await expect(page.locator('.tool-landing .hero-preview')).toBeVisible();
    }
  }
  expect(processingRequests).toBe(0);
});

test('landing discovery modules point to published tools and real articles while FAQs stay independent', async ({ page, request }) => {
  await page.goto('/gemini-watermark-remover');
  await expect(page.locator('.tool-landing .faq-list')).toContainText('Does WatermarkGemini remove SynthID?');
  const toolLinks = await page.locator('.tool-landing .tool-grid a').evaluateAll(links => links.map(link => link.getAttribute('href')));
  const guideLinks = await page.locator('.tool-landing .guides-list a').evaluateAll(links => links.map(link => link.getAttribute('href')));
  expect(toolLinks.length).toBeGreaterThan(0);
  expect(guideLinks.length).toBeGreaterThan(0);
  for (const href of toolLinks) {
    expect(href).toMatch(/^\/(?:[a-z0-9-]+|#tool)$/);
    expect((await request.get(href!)).status(), `${href} should be a published tool`).toBe(200);
  }
  for (const href of guideLinks) {
    expect(href).toMatch(/^\/blog\/[a-z0-9-]+$/);
    expect((await request.get(href!)).status(), `${href} should be a published guide`).toBe(200);
  }
  await page.goto('/remove-background');
  await expect(page.locator('.tool-landing .faq-list')).not.toContainText('Does WatermarkGemini remove SynthID?');
  await expect(page.locator('main h1')).toContainText(/background/i);
});

test('the shared template keeps availability labels and does not alter the homepage', async ({ page }) => {
  await page.goto('/batch-watermark-remover');
  await expect(page.locator('.tool-landing')).toBeVisible();
  await expect(page.locator('.hero-status-badge')).toHaveText('Coming Soon');
  await page.goto('/');
  await expect(page.locator('.tool-landing')).toHaveCount(0);
  await expect(page.locator('.home-blueprint')).toBeVisible();
  await expect(page.locator('.site-header')).toBeVisible();
});
