import { expect, test } from '@playwright/test';

const uploadKey = 'uploads/00000000-0000-4000-8000-000000000001.png';
const jobId = '00000000-0000-4000-8000-000000000002';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

async function chooseTestImage(page: import('@playwright/test').Page) {
  const uploader = page.locator('#tool');
  await uploader.scrollIntoViewIfNeeded();
  await expect(uploader.locator('astro-island')).not.toHaveAttribute('ssr', '');

  const fileInput = uploader.locator('input[type="file"]');
  await expect(fileInput).toHaveAttribute('aria-label', /\S+/);
  await fileInput.setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: png });
}

test('uploads, processes, and exposes a download through the UI', async ({ page }) => {
  await page.route('**/api/auth/get-session', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ user: { id: 'google-user-1', name: 'Test User', email: 'test@example.com' }, session: { id: 'session-1' } }),
  }));
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
  await page.locator('#tool .preview-panel .button-primary').click();

  await expect(page.locator('#tool .demo-note')).toBeVisible();
  await expect(page.locator('#tool .result-actions a.button-primary')).toHaveAttribute('href', 'https://results.test/download.png');
});

test('shows a safe message when the upload service is unavailable', async ({ page }) => {
  await page.route('**/api/auth/get-session', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ user: { id: 'google-user-1', name: 'Test User', email: 'test@example.com' }, session: { id: 'session-1' } }),
  }));
  await page.route('**/api/upload-url', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'Upload service is temporarily unavailable.' }),
  }));

  await page.goto('/');
  await chooseTestImage(page);
  await page.locator('#tool .preview-panel .button-primary').click();

  const alert = page.getByRole('alert');
  await expect(alert).toHaveText('Upload service is temporarily unavailable.');
  await expect(alert).not.toContainText('R2_SECRET_ACCESS_KEY');
});

test('keeps selection anonymous and asks for Google sign-in only when processing', async ({ page }) => {
  let uploadRequested = false;
  await page.route('**/api/auth/get-session', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: 'null',
  }));
  await page.route('**/api/upload-url', (route) => {
    uploadRequested = true;
    return route.abort();
  });

  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  await chooseTestImage(page);
  await page.locator('#tool .preview-panel .button-primary').click();

  await expect(page.locator('#tool [role="dialog"]')).toBeVisible();
  await expect(page.locator('#tool .auth-google-button')).toBeVisible();
  expect(uploadRequested).toBe(false);
});
