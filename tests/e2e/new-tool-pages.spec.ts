import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { waitForWorkspace } from '../helpers/workspace';

const slugs = ['remove-emoji-from-photo', 'remove-person-from-photo', 'remove-logo-from-video', 'remove-text-from-video', 'remove-object-from-video'];
const video = readFileSync(new URL('../fixtures/workspace-24fps.mp4', import.meta.url));

async function keepFilesLocal(page: Page) {
  await page.route('**/api/auth/get-session', route => route.fulfill({ json: null }));
  await page.route('**/api/v1/capabilities', route => route.fulfill({ json: { operations: [
    { operation: 'image-watermark', enabled: true, maxBytes: 10485760 },
    { operation: 'object-removal', enabled: true, maxBytes: 10485760 },
    { operation: 'video-watermark', enabled: true, maxBytes: 104857600, requiredFps: 24, maxDurationSeconds: 540 },
  ] } }));
  await page.route('**/api/payments/catalog', route => route.fulfill({ json: { enabled: false, creditsEnabled: false, packages: [] } }));
  const writes: string[] = [];
  await page.route(/\/api\/(?:v1\/)?(?:uploads?|upload-url|quotes|jobs)(?:\/|\?|$)/, route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { jobs: [] } });
    writes.push(route.request().url()); return route.abort();
  });
  return writes;
}

for (const slug of slugs) {
  test(`${slug} publishes supplied content, native pairs and labels at both widths`, async ({ page }) => {
    test.setTimeout(90_000);
    const writes = await keepFilesLocal(page);
    const copy = JSON.parse(readFileSync(`src/content/landing-pages/${slug}.json`, 'utf8'));
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/' + slug, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('h1')).toHaveText(copy.heading);
      await expect(page).toHaveTitle(copy.title);
      await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', new RegExp('/' + slug + '$'));
      await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', new RegExp(copy.shareImage + '$'));
      await expect(page.locator('#tool input[type=file]')).toBeEnabled({ timeout: 30_000 });
      await expect(page.locator('#tool button')).toHaveText(copy.uploadButtonLabel);
      await expect(page.locator('.hero-tool .tool-note')).toHaveText(copy.toolNote);
      const pairs = page.locator('[data-landing-preview]');
      await expect(pairs).toHaveCount(3);
      for (const [index, sample] of copy.heroSamples.entries()) {
        await expect(pairs.nth(index).locator('[data-image-side=before] img')).toHaveAttribute('src', sample.image);
        await expect(pairs.nth(index).locator('[data-image-side=after] img')).toHaveAttribute('src', sample.afterImage);
      }
      await expect(page.locator('.feature-item')).toHaveCount(4);
      await expect(page.locator('#ai-tools .tool-card')).toHaveCount(8);
      await expect(page.locator('#guides li a')).toHaveCount(6);
      await expect(page.locator('.faq-list details')).toHaveCount(11);
      await page.locator('.site-cta').scrollIntoViewIfNeeded();
      await expect(page.locator('.site-cta input[type=file]')).toBeEnabled({ timeout: 30_000 });
      await expect(page.locator('.site-cta button')).toHaveText(copy.cta.buttonLabel);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
    expect(writes).toEqual([]);
  });
}

test('all five new pages hand local files to the existing recommended operation without uploading', async ({ page }) => {
  test.setTimeout(180_000);
  const writes = await keepFilesLocal(page);
  const png = await sharp({ create: { width: 80, height: 60, channels: 3, background: '#aabbaa' } }).png().toBuffer();
  for (const slug of slugs) {
    const photo = slug.endsWith('photo');
    await page.goto('/' + slug, { waitUntil: 'domcontentloaded' });
    const input = page.locator('#tool input[type=file]'); await expect(input).toBeEnabled();
    await input.setInputFiles({ name: photo ? 'original-photo.png' : 'original-video.mp4', mimeType: photo ? 'image/png' : 'video/mp4', buffer: photo ? png : video });
    await waitForWorkspace(page);
    await expect(page.getByLabel('Choose operation')).toHaveValue(photo ? 'object-removal' : 'video-watermark');
    await expect(page.getByText(photo ? 'original-photo.png' : 'original-video.mp4', { exact: true })).toBeVisible();
  }
  expect(writes).toEqual([]);
});
