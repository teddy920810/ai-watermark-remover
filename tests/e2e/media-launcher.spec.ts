import { expect, test, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const videoBytes = readFileSync(new URL('../fixtures/workspace-24fps.mp4', import.meta.url));
const capabilities = { operations: [
  { operation: 'image-watermark', enabled: true, acceptedTypes: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: 10 * 1024 * 1024 },
  { operation: 'video-watermark', enabled: true, acceptedTypes: ['video/mp4'], maxBytes: 100 * 1024 * 1024, maxDurationSeconds: 540, requiredFps: 24 },
] };
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const photo = () => sharp({ create: { width: 80, height: 60, channels: 3, background: '#bca' } }).png().toBuffer();
async function anonymous(page: Page, limits = capabilities) {
  await page.route('**/api/auth/get-session', route => json(route, null));
  await page.route('**/api/v1/capabilities', route => json(route, limits));
  const writes: string[] = [];
  page.on('request', request => { if (request.method() !== 'GET' && /\/api\/(v1\/)?(uploads?|upload-url|quotes|jobs)/.test(request.url())) writes.push(request.url()); });
  return writes;
}

test('homepage uses one upload action for images and MP4 without a media selector', async ({ page }) => {
  await anonymous(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Upload file', exact: true })).toBeEnabled();
  await expect(page.locator('.media-launcher .launcher-modes')).toHaveCount(0);
  await expect(page.getByTestId('media-launcher-file')).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp,video/mp4');
  await expect(page.getByTestId('media-launcher-file')).toHaveAccessibleName('Choose an image or MP4 video');
  await expect(page.locator('.launcher-requirements')).toContainText('10 MB');
  await expect(page.locator('.launcher-requirements')).toContainText('100 MB');
});

test('an image with no MIME is recognized, restored after reload, and never uploaded by the launcher', async ({ page }) => {
  const writes = await anonymous(page);
  await page.goto('/');
  await expect(page.getByTestId('media-launcher-file')).toBeEnabled();
  await page.getByTestId('media-launcher-file').setInputFiles({ name: 'camera-file', mimeType: '', buffer: await photo() });
  await expect(page).toHaveURL(/\/app\/image$/);
  await expect(page.getByText('camera-file', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('camera-file', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in to continue', exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});

test('an MP4 goes directly to the video workspace with its local draft and no upload or charge', async ({ page }) => {
  const writes = await anonymous(page);
  await page.goto('/');
  await expect(page.getByTestId('media-launcher-file')).toBeEnabled();
  await page.getByTestId('media-launcher-file').setInputFiles({ name: 'holiday.mp4', mimeType: 'video/mp4', buffer: videoBytes });
  await expect(page).toHaveURL(/\/app\/video$/);
  await expect(page.getByText('holiday.mp4', { exact: true })).toBeVisible();
  await expect(page.locator('video')).toHaveAttribute('src', /^blob:/);
  await expect(page.getByRole('button', { name: 'Sign in to continue', exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});

test('dropping a video uses the same automatic handoff', async ({ page }) => {
  const writes = await anonymous(page);
  await page.goto('/');
  await expect(page.getByTestId('media-launcher-file')).toBeEnabled();
  const transfer = await page.evaluateHandle(base64 => {
    const data = new DataTransfer();
    data.items.add(new File([Uint8Array.from(atob(base64), value => value.charCodeAt(0))], 'dropped.mp4', { type: 'video/mp4' }));
    return data;
  }, videoBytes.toString('base64'));
  await page.locator('.launcher-drop').dispatchEvent('drop', { dataTransfer: transfer });
  await expect(page).toHaveURL(/\/app\/video$/);
  await expect(page.getByText('dropped.mp4', { exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});

test('forged and unsupported files fail locally and leave the upload action usable', async ({ page }) => {
  const writes = await anonymous(page);
  await page.goto('/');
  const input = page.getByTestId('media-launcher-file');
  await expect(input).toBeEnabled();
  await input.setInputFiles({ name: 'fake-image.jpg', mimeType: 'image/jpeg', buffer: videoBytes });
  await expect(page.getByRole('alert')).toContainText('does not match its contents');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('button', { name: 'Upload file', exact: true })).toBeEnabled();
  await input.setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
  await expect(page.getByRole('alert')).toContainText('not a supported JPG, PNG, WebP image or MP4 video');
  expect(writes).toEqual([]);
});

test('the detected image and video each use their own advertised admission limit', async ({ page }) => {
  const limits = { operations: capabilities.operations.map(value => ({ ...value, maxBytes: value.operation === 'image-watermark' ? 64 : 1000 })) };
  const writes = await anonymous(page, limits);
  await page.goto('/');
  const input = page.getByTestId('media-launcher-file');
  await expect(input).toBeEnabled();
  await input.setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: await photo() });
  await expect(page.getByRole('alert')).toContainText('image exceeds the current 64 bytes upload limit');
  await input.setInputFiles({ name: 'holiday.mp4', mimeType: 'video/mp4', buffer: videoBytes });
  await expect(page.getByRole('alert')).toContainText('video upload limits');
  await expect(page).toHaveURL(/\/$/);
  expect(writes).toEqual([]);
});

test('unreachable capability checks do not claim that processing is paused', async ({ page }) => {
  await anonymous(page);
  await page.route('**/api/v1/capabilities', route => json(route, { error: 'Unavailable' }, 503));
  await page.goto('/');
  await expect(page.locator('.media-launcher')).toContainText('availability could not be checked');
  await expect(page.locator('.media-launcher')).not.toContainText(/processing is paused|processing is temporarily unavailable/i);
  await expect(page.getByRole('button', { name: 'Upload file', exact: true })).toBeEnabled();
});

test('the video landing page retains its focused MP4 entry', async ({ page }) => {
  await anonymous(page);
  await page.goto('/video-watermark-remover');
  await expect(page.getByTestId('media-launcher-file')).toBeEnabled();
  await expect(page.getByTestId('media-launcher-file')).toHaveAttribute('accept', 'video/mp4');
  await expect(page.getByRole('button', { name: 'Upload video', exact: true })).toBeVisible();
  await expect(page.locator('.launcher-modes')).toBeVisible();
});
