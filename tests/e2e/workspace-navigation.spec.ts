import { waitForWorkspace } from '../helpers/workspace';
import { expect, test } from '@playwright/test';
import { geminiImage } from '../helpers/gemini-fixtures';
import { openWorkspace } from '../helpers/workspace';

test('the workspace exposes seven flat tools and preserves the registration reward', async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('**/api/auth/get-session', route => route.fulfill({ json: null }));
  await page.goto('/app');
  await waitForWorkspace(page);
  const navigation = page.getByRole('navigation', { name: 'Workspace tools' });
  for (const name of ['Gemini Remover', 'TikTok Video', 'Image Watermark', 'PRO Watermark', 'Background Remover', 'Object Remover', 'Video Watermark']) {
    await expect(navigation.getByRole('link', { name, exact: true })).toBeVisible();
  }
  await expect(page.locator('main h1')).toHaveText('Less watermark. More possibility.');
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Get 100 Free Credits', exact: true })).toBeVisible();
  await page.screenshot({ path: 'output/unified-workspace/home-desktop.png', fullPage: true });
  await navigation.getByRole('link', { name: 'Background Remover', exact: true }).click();
  await expect(page.locator('main h1')).toHaveText('Background Remover');
  await expect(navigation.getByRole('link', { name: 'Background Remover', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open tool navigation' }).click();
  await expect(navigation.getByRole('link', { name: 'PRO Watermark', exact: true })).toBeVisible();
  await page.screenshot({ path: 'output/unified-workspace/navigation-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('anonymous Gemini produces real PNG bytes without authentication or cloud processing', async ({ page }) => {
  test.setTimeout(90000);
  let sessionReads = 0; const writes: string[] = [];
  await page.route('**/api/auth/get-session', route => { sessionReads++; return route.fulfill({ status: 503, json: { error: 'Identity offline' } }); });
  await page.route('**/api/v1/capabilities', route => route.fulfill({ status: 503, json: {} }));
  page.on('request', request => { if (request.method() === 'POST') writes.push(new URL(request.url()).pathname); });
  await page.goto('/app/free/gemini');
  await waitForWorkspace(page);
  await page.getByLabel('Choose a Gemini image or video').setInputFiles({ name: 'local.png', mimeType: 'image/png', buffer: await geminiImage() });
  await page.getByRole('button', { name: 'Remove watermark — Free', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Download PNG — Free' })).toBeVisible({ timeout: 60000 });
  expect(sessionReads).toBeGreaterThan(0);
  expect(writes).toEqual([]);
  const href = await page.getByRole('link', { name: 'Download PNG — Free' }).getAttribute('href');
  const signature = await page.evaluate(async url => [...new Uint8Array(await (await fetch(url!)).arrayBuffer()).slice(0, 8)], href);
  expect(signature).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  await expect(page.getByRole('navigation', { name: 'Workspace tools' }).getByRole('link', { name: 'Gemini Remover' })).toHaveAttribute('aria-current', 'page');
});

test('switching from video to an image tool opens the correct editor without charging', async ({ page }) => {
  test.setTimeout(60000);
  await page.route('**/api/auth/get-session', route => route.fulfill({ json: null }));
  await page.route('**/api/v1/capabilities', route => route.fulfill({ json: { operations: [] } }));
  const writes: string[] = [];
  page.on('request', request => { if (request.method() === 'POST') writes.push(request.url()); });
  await openWorkspace(page, '/app/video');
  await page.getByRole('navigation', { name: 'Workspace tools' }).getByRole('link', { name: 'Image Watermark', exact: true }).click();
  await expect(page.locator('main h1')).toHaveText('Image Watermark Remover');
  await expect(page.locator('[data-app-shell]')).toHaveAttribute('data-operation', 'image-watermark');
  expect(writes).toEqual([]);
});
