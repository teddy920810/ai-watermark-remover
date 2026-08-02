import { expect, test } from '@playwright/test';

const uploadKey = 'uploads/00000000-0000-4000-8000-000000000001.png';
const jobId = '00000000-0000-4000-8000-000000000002';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

async function chooseTestImage(page: import('@playwright/test').Page) {
  const uploader = page.locator('#tool');
  await uploader.scrollIntoViewIfNeeded();
  await expect(uploader.locator('astro-island')).not.toHaveAttribute('ssr', '');

  const fileInput = uploader.locator('input[type="file"]');
  await expect(fileInput).toHaveAttribute('aria-label', 'Choose image to upload');
  await fileInput.setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: png });
}

test('uploads, processes, and exposes a download through the UI', async ({ page }) => {
  await page.route('**/api/upload-url', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ url: 'https://uploads.test/object', key: uploadKey, expiresIn: 600 }),
  }));
  await page.route('https://uploads.test/object', (route) => route.fulfill({ status: 200 }));
  await page.route('**/api/jobs', (route) => route.fulfill({
    status: 201,
    contentType: 'application/json',
    body: JSON.stringify({ id: jobId, status: 'completed' }),
  }));
  await page.route(`**/api/jobs/${jobId}`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      status: 'completed',
      resultUrl: 'https://results.test/result.png',
      downloadUrl: 'https://results.test/download.png',
    }),
  }));

  await page.goto('/');
  await chooseTestImage(page);
  await page.getByRole('button', { name: 'Remove watermark' }).click();

  await expect(page.getByText('Demo mode returns a secure copy while the real AI provider is being integrated.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download result' })).toHaveAttribute('href', 'https://results.test/download.png');
});

test('shows a safe message when the upload service is unavailable', async ({ page }) => {
  await page.route('**/api/upload-url', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'Upload service is temporarily unavailable.' }),
  }));

  await page.goto('/');
  await chooseTestImage(page);
  await page.getByRole('button', { name: 'Remove watermark' }).click();

  const alert = page.getByRole('alert');
  await expect(alert).toHaveText('Upload service is temporarily unavailable.');
  await expect(alert).not.toContainText('R2_SECRET_ACCESS_KEY');
});
