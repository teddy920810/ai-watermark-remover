import { waitForWorkspace } from '../helpers/workspace';
import { expect, test, type Locator, type Page } from '@playwright/test';
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

type ConfiguredImage = { image?: string; afterImage?: string; imageAlt: string; comparison?: { image?: string; beforeImage?: string } };

async function expectConfiguredImage(display: Locator, item: ConfiguredImage) {
  const legacyAfter = item.comparison?.image || item.image;
  const legacyPair = item.comparison?.beforeImage && item.comparison.beforeImage !== legacyAfter;
  const beforeSource = item.afterImage ? item.image || item.comparison?.image : legacyPair ? item.comparison!.beforeImage : item.image || item.comparison?.image;
  const afterSource = item.afterImage || (legacyPair ? legacyAfter : undefined);
  expect(beforeSource).toBeTruthy();
  const before = display.locator('[data-image-side="before"] img');
  await display.scrollIntoViewIfNeeded();
  await expect(before).toHaveAttribute('src', beforeSource!);
  await expect(before).toHaveAttribute('alt', item.imageAlt);
  await expect(display.locator('.landing-watermark,.fixed-watermark')).toHaveCount(0);
  await expect(display.locator('img')).toHaveCount(afterSource ? 2 : 1);
  if (afterSource) {
    expect(afterSource).not.toBe(beforeSource);
    const after = display.locator('[data-image-side="after"] img');
    await expect(after).toHaveAttribute('src', afterSource);
    await expect(after).toHaveAttribute('alt', item.imageAlt);
    await expect(display).toHaveAttribute('data-pair', 'true');
    await expect(display).toHaveAttribute('data-ready', 'true');
    await expect(after).toBeVisible();
    await expect(display.locator('.image-display-controls')).toBeVisible();
    await expect(display.locator('.image-display-before')).toHaveText('Before');
    await expect(display.locator('.image-display-after')).toHaveText('After');
    const range = display.getByRole('slider', { name: `Compare before and after: ${item.imageAlt}`, exact: true });
    await expect(range).toHaveCount(1);
    await expect(range).toHaveAttribute('min', '0');
    await expect(range).toHaveAttribute('max', '100');
    await expect(range).toHaveValue('50');
    await range.focus(); await range.press('Home'); await expect(range).toHaveValue('0');
    await expect.poll(() => display.evaluate(element => (element as HTMLElement).style.getPropertyValue('--image-position'))).toBe('0%');
    const divider = display.locator('.image-display-divider');
    const start = (await divider.boundingBox())!.x;
    await range.press('End'); await expect(range).toHaveValue('100');
    await expect.poll(() => display.evaluate(element => (element as HTMLElement).style.getPropertyValue('--image-position'))).toBe('100%');
    expect((await divider.boundingBox())!.x - start).toBeCloseTo((await display.boundingBox())!.width, 0);
    await range.press('ArrowLeft'); await expect(range).toHaveValue('99');
    await expect(display.locator('[data-image-side="before"]')).toHaveCSS('clip-path', 'inset(0px 1% 0px 0px)');
  } else {
    await expect(display.locator('input[type="range"],.image-display-controls,.image-display-label,.image-display-divider,[data-image-side="after"]')).toHaveCount(0);
    await expect(display).toHaveAttribute('data-ready', 'false');
  }
  for (const image of await display.locator('img').all()) {
    await expect.poll(() => image.evaluate(async element => {
      const image = element as HTMLImageElement;
      try { await image.decode(); return image.complete && image.naturalWidth > 0 && image.naturalHeight > 0; } catch { return false; }
    })).toBe(true);
    await expect(image).toBeVisible();
  }
  if (afterSource) {
    const ratios = await display.locator('img').evaluateAll(images => images.map(element => (element as HTMLImageElement).naturalWidth / (element as HTMLImageElement).naturalHeight));
    expect(Math.abs(ratios[0] - ratios[1])).toBeLessThan(0.01);
  }
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
      await expect(launcher).toHaveAttribute('data-media-launcher', 'auto');
      const button = launcher.getByRole('button', { name: 'Upload file', exact: true });
      await expect(button).toBeEnabled();
      await expect(launcher.locator('.launcher-modes')).toHaveCount(0);
      await expect(launcher.locator('.launcher-workspace-link')).toHaveAttribute('href', kind === 'video' ? '/app/video' : '/app');
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
      if (width === 390) expect(action!.y + action!.height, 'primary mobile upload remains above the fold').toBeLessThanOrEqual(900);
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
    await expect(page).toHaveURL(/\/app\/image$/); await waitForWorkspace(page);
    await expect(page.getByText('landing-image.png', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in to continue', exact: true })).toBeVisible();
    await page.goto('/video-watermark-remover', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('media-launcher-file')).toBeEnabled();
    await expect(page.getByTestId('media-launcher-file')).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp,video/mp4');
    await page.getByTestId('media-launcher-file').setInputFiles({ name: 'landing-video.mp4', mimeType: 'video/mp4', buffer: videoBytes });
    await expect(page).toHaveURL(/\/app\/video$/); await waitForWorkspace(page);
    await expect(page.getByText('landing-video.mp4', { exact: true })).toBeVisible();
    await expect(page.locator('video')).toHaveAttribute('src', /^blob:/);
    await expect(page.getByRole('button', { name: 'Sign in to continue', exact: true })).toBeVisible();
  }
  expect(writes).toEqual([]);
});

test('Gemini features preserve configured single images and real pairs without synthetic overlays', async ({ page }) => {
  const writes = await anonymousLauncher(page);
  const content = JSON.parse(readFileSync(new URL('../../src/content/landing-pages/gemini-watermark-remover.json', import.meta.url), 'utf8'));
  for (const width of [1920, 390]) {
    await page.setViewportSize({ width, height: 1080 }); await page.goto('/gemini-watermark-remover');
    const features = page.locator('.landing-features-section .feature-item'); await expect(features).toHaveCount(4);
    for (let index = 0; index < 4; index++) {
      const feature = features.nth(index); await feature.scrollIntoViewIfNeeded();
      await expectConfiguredImage(feature.locator('[data-image-display]'), content.features.items[index]);
      const image = feature.locator('[data-image-side="before"] img');
      expect((await image.boundingBox())!.height).toBeGreaterThan(100);
      expect((await image.boundingBox())!.height).toBeCloseTo((await feature.locator('.feature-media').boundingBox())!.height - 2, 0);
      await expect(feature.locator('.landing-watermark,.fixed-watermark')).toHaveCount(0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  expect(writes).toEqual([]);
});

test('landing configured examples switch and reset on desktop and mobile without creating processing requests', async ({ page }) => {
  const writes = await anonymousLauncher(page);
  const content = JSON.parse(readFileSync(new URL('../../src/content/landing-pages/gemini-watermark-remover.json', import.meta.url), 'utf8'));

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/gemini-watermark-remover');
    await expect(page.locator('.tool-landing')).toBeVisible();
    await expect(page.locator('[data-landing-sample]')).toHaveCount(3);
    await expect(page.locator('[data-landing-preview]:visible')).toHaveCount(1);
    for (const index of [0, 1, 2, 0]) {
      const sample = page.locator('[data-landing-sample]').nth(index);
      await sample.click();
      await expect(sample).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('[data-landing-sample][aria-pressed="true"]')).toHaveCount(1);
      await expect(page.locator('[data-landing-preview]:visible')).toHaveCount(1);
      await expectConfiguredImage(page.locator('[data-landing-preview]:visible [data-image-display]'), content.heroSamples[index]);
    }
    await expect(page.locator('.tool-landing .landing-watermark,.tool-landing .fixed-watermark')).toHaveCount(0);

    const faq = page.locator('.tool-landing .faq-list details').first();
    await faq.locator('summary').click();
    await expect(faq).toHaveAttribute('open', '');
    await expect(faq.locator('p')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  expect(writes).toEqual([]);
});

test('background and object content hand files to their App editor and share replacement intake', async ({ page }) => {
  const writes = await anonymousLauncher(page);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [route, operation] of [['/remove-background', 'background-removal'], ['/remove-object', 'object-removal']]) {
      await page.goto(route); await expect(page.getByTestId('media-launcher-file')).toBeEnabled();
      await page.getByTestId('media-launcher-file').setInputFiles(sampleImage);
      await expect(page.getByLabel('Choose operation')).toHaveValue(operation);
      await expect(page.locator('.workspace-stage-panel img[src^="blob:"]').first()).toBeVisible();
      if (operation === 'object-removal') {
        await expect(page.getByRole('button', { name: 'Brush', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Lasso', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Sign in to continue', exact: true })).toBeEnabled();
        await expect(page.getByLabel('Processing cost')).toHaveCount(0);
      }
      await page.getByLabel('Upload file to workspace', { exact: true }).setInputFiles({ name: 'another.png', mimeType: 'image/png', buffer: await sharp({ create: { width: 80, height: 60, channels: 3, background: '#aabbcc' } }).png().toBuffer() });
      await expect(page.getByText('another.png', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
  }
  expect(writes).toEqual([]);
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

test('the shared template omits retired availability labels and does not alter the homepage', async ({ page }) => {
  await page.goto('/batch-watermark-remover');
  await expect(page.locator('.tool-landing')).toBeVisible();
  await expect(page.locator('.hero-status-badge')).toHaveCount(0);
  await expect(page.locator('.tool-landing')).not.toContainText(/coming\s+soon/i);
  await page.goto('/');
  await expect(page.locator('.tool-landing')).toHaveCount(0);
  await expect(page.locator('.home-blueprint')).toBeVisible();
  await expect(page.locator('.site-header')).toBeVisible();
});
