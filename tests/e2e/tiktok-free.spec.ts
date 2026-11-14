import { expect, test } from '@playwright/test';
const url = 'https://www.tiktok.com/@tester/video/7705574984709688596';
const video = 'https://d.rapidcdn.app/v2?token=TEST&dl=1';
test('link input, actual resource count, download and reset work without paid APIs', async ({ page }) => {
  const forbidden: string[] = [];
  page.on('request', request => { if (/\/api\/(v1|auth)\//.test(request.url())) forbidden.push(request.url()); });
  await page.route('**/api/tools/tiktok/resolve', async route => {
    expect(route.request().postDataJSON()).toEqual({ operation: 'tiktok-video-resolve', url });
    await route.fulfill({ json: { operation: 'tiktok-video-resolve', title: 'Test video', cover: null, videos: [{ url: video }] } });
  });
  await page.route('https://d.rapidcdn.app/**', route => route.fulfill({ path: 'tests/fixtures/workspace-24fps.mp4', contentType: 'video/mp4', headers: { 'Content-Disposition': 'attachment; filename="sample.mp4"' } }));
  await page.goto('/app/free/tiktok');
  await expect(page.getByRole('heading', { name: 'TikTok Watermark Remover for Saved Videos' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save Video', exact: true })).toBeDisabled();
  await page.getByLabel('TikTok URL', { exact: true }).fill(url);
  await page.getByRole('button', { name: 'Save Video', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Video preview' })).toBeVisible();
  await expect(page.getByText('1 available', { exact: true })).toBeVisible();
  await expect(page.getByText(/HD|Quality 2/)).toHaveCount(0);
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download video MP4 file' }).click();
  expect((await download).suggestedFilename()).toBe('sample.mp4');
  await page.getByRole('button', { name: 'Clear TikTok URL', exact: true }).click();
  await expect(page.getByLabel('TikTok URL', { exact: true })).toHaveValue('');
  await expect(page.locator('video')).toHaveCount(0);
  await expect(page.getByLabel('TikTok URL', { exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: 'New video', exact: true })).toHaveCount(0);
  expect(forbidden).toEqual([]);
});
test('errors can be corrected, changed input clears results, and mobile fits', async ({ page }) => {
  let count = 0;
  await page.route('**/api/tools/tiktok/resolve', route => {
    count++;
    return count === 1 ? route.fulfill({ status: 502, json: { error: 'This video is unavailable. Try another link.' } }) : route.fulfill({ json: { operation: 'tiktok-video-resolve', title: '', cover: null, videos: [{ url: video }] } });
  });
  await page.route('https://d.rapidcdn.app/**', route => route.abort());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/free/tiktok');
  await page.getByLabel('TikTok URL', { exact: true }).fill(url);
  await page.getByRole('button', { name: 'Save Video', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('unavailable');
  await page.getByRole('button', { name: 'Save Video', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Download video MP4 file' })).toBeVisible();
  await expect(page.getByText('Preview unavailable. You can still try downloading the video.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByLabel('TikTok URL', { exact: true }).fill(url + '?lang=en');
  await expect(page.getByRole('link', { name: 'Download video MP4 file' })).toHaveCount(0);
});
test('reset cancels a pending result so it cannot reappear', async ({ page }) => {
  await page.route('**/api/tools/tiktok/resolve', async route => {
    await new Promise(resolve => setTimeout(resolve, 500));
    await route.fulfill({ json: { operation: 'tiktok-video-resolve', title: '', cover: null, videos: [{ url: video }] } }).catch(() => undefined);
  });
  await page.goto('/app/free/tiktok');
  await page.getByLabel('TikTok URL', { exact: true }).fill(url);
  await page.getByRole('button', { name: 'Save Video', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resolving…' })).toBeDisabled();
  await page.getByRole('button', { name: 'Clear TikTok URL', exact: true }).click();
  await expect(page.getByLabel('TikTok URL', { exact: true })).toHaveValue('');
  await page.waitForTimeout(600);
  await expect(page.locator('video')).toHaveCount(0);
});

test('landing input navigates and resolves once, while reload does not repeat the launch', async ({ page }) => {
  // Three cold page loads plus workspace hydration, rather than a single-page check.
  test.setTimeout(60_000);
  let resolves = 0;
  await page.route('**/api/tools/tiktok/resolve', route => {
    resolves++;
    expect(route.request().postDataJSON()).toEqual({ operation: 'tiktok-video-resolve', url });
    return route.fulfill({ json: { operation: 'tiktok-video-resolve', title: 'From landing', cover: null, videos: [{ url: video }] } });
  });
  await page.route('https://d.rapidcdn.app/**', route => route.fulfill({ path: 'tests/fixtures/workspace-24fps.mp4', contentType: 'video/mp4', headers: { 'Content-Disposition': 'attachment; filename="landing.mp4"' } }));
  await page.goto('/');
  const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: 'Video & Batch Tools', exact: true }).click();
  await page.getByRole('link', { name: 'TikTok Watermark Remover', exact: true }).click();
  await expect(page).toHaveURL(/\/tiktok-watermark-remover$/);
  await expect(page.locator('main').getByRole('button', { name: 'Upload file', exact: true })).toHaveCount(0);
  const entry = page.locator('#tool');
  await expect(entry.getByRole('button', { name: 'Save Video', exact: true })).toBeDisabled();
  await entry.getByLabel('TikTok URL', { exact: true }).fill(url);
  await entry.getByRole('button', { name: 'Save Video', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Video preview' })).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/app\/free\/tiktok$/);
  await expect(page.getByLabel('TikTok URL', { exact: true })).toHaveValue(url);
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download video MP4 file' }).click();
  expect((await download).suggestedFilename()).toBe('landing.mp4');
  expect(resolves).toBe(1);
  await page.reload();
  await expect(page.getByLabel('TikTok URL', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Save Video', exact: true })).toBeDisabled();
  expect(resolves).toBe(1);
});

test('mobile footer launches automatically and keeps a failed link for explicit retry', async ({ page }) => {
  test.setTimeout(60_000);
  let resolves = 0;
  await page.route('**/api/tools/tiktok/resolve', route => {
    resolves++;
    return resolves === 1 ? route.fulfill({ status: 502, json: { error: 'Video unavailable. Try again.' } })
      : route.fulfill({ json: { operation: 'tiktok-video-resolve', title: '', cover: null, videos: [{ url: video }] } });
  });
  await page.route('https://d.rapidcdn.app/**', route => route.abort());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tiktok-watermark-remover');
  const footer = page.locator('.site-cta');
  await footer.scrollIntoViewIfNeeded();
  await footer.getByLabel('TikTok URL', { exact: true }).fill(url);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await footer.getByRole('button', { name: 'Save Video', exact: true }).click();
  await expect(page.getByLabel('TikTok URL', { exact: true })).toHaveValue(url, { timeout: 15_000 });
  await expect(page.getByRole('alert')).toContainText('unavailable');
  await expect(page).toHaveURL(/\/app\/free\/tiktok$/);
  expect(resolves).toBe(1);
  await page.getByRole('button', { name: 'Save Video', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Download video MP4 file' })).toBeVisible();
  expect(resolves).toBe(2);
});

test('workspace menu exposes TikTok without adding a paid processing operation', async ({ page }) => {
  await page.route('**/api/auth/get-session', route => route.fulfill({ json: null }));
  await page.route('**/api/v1/**', route => route.fulfill({ json: { operations: [], jobs: [] } }));
  await page.goto('/app/video');
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.getByRole('link', { name: 'TikTok watermark remover', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/free\/tiktok$/);
  await expect(page.getByLabel('TikTok URL', { exact: true })).toBeVisible();
});
