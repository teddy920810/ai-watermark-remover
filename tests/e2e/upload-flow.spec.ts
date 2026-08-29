import { expect, test } from '@playwright/test';
import { inspectPngArtifact } from '../../scripts/lib/png-artifact.mjs';

const uploadKey = 'uploads/00000000-0000-4000-8000-000000000001.png';
const jobId = '00000000-0000-4000-8000-000000000002';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAC0lEQVQImWNgQAcAABIAAW/6Y7cAAAAASUVORK5CYII=', 'base64');

async function downloadBytes(download: import('@playwright/test').Download) {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function chooseTestImage(page: import('@playwright/test').Page) {
  const uploader = page.locator('#tool');
  await uploader.scrollIntoViewIfNeeded();
  await expect(uploader.locator('astro-island')).not.toHaveAttribute('ssr', '');

  const fileInput = uploader.locator('input[type="file"]');
  await expect(fileInput).toHaveAttribute('aria-label', /\S+/);
  await fileInput.setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: png });
}

test('uploads, processes, and exposes a download through the UI', async ({ page }) => {
  let balance = 1;
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
  await page.route('**/api/me/benefits', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ balance, cap: 3, dailyReward: 1, checkedInToday: false }),
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
  await expect(page.locator('.header-benefits')).toContainText('Free uses 1/3');
  await chooseTestImage(page);
  balance = 0;
  await page.locator('#tool .preview-panel .button-primary').click();

  await expect(page.locator('#tool .demo-note')).toBeVisible();
  await expect(page.locator('#tool .result-actions a.button-primary')).toHaveAttribute('href', 'https://results.test/download.png');
  await expect(page.locator('.header-benefits')).toContainText('Free uses 0/3');
});

test('background remover shares the balance and exposes color choices without an editor', async ({ page }) => {
  let balance = 1;
  let operation = '';
  await page.route('**/api/auth/get-session', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ user: { id: 'google-user-1', name: 'Test User' }, session: { id: 'session-1' } }),
  }));
  await page.route('**/api/me/benefits', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ balance, cap: 3, dailyReward: 1, checkedInToday: false }),
  }));
  await page.route('**/api/upload-url', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ url: 'https://uploads.test/background', key: uploadKey, expiresIn: 600 }),
  }));
  await page.route('https://uploads.test/background', (route) => route.fulfill({ status: 200 }));
  await page.route('**/api/jobs', async (route) => {
    operation = (route.request().postDataJSON() as { operation?: string }).operation ?? '';
    balance = 0;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ id: jobId, status: 'completed' }),
    });
  });
  await page.route(`**/api/jobs/${jobId}`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      status: 'completed',
      resultUrl: 'https://results.test/background.png',
      downloadUrl: 'https://results.test/background-download.png',
    }),
  }));
  await page.route('https://results.test/background.png', (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    headers: { 'Content-Disposition': 'attachment; filename="background-removed-image.png"' },
    body: transparentPng,
  }));
  await page.route('https://results.test/background-download.png', (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    headers: { 'Content-Disposition': 'attachment; filename="background-removed-image.png"' },
    body: transparentPng,
  }));

  await page.goto('/background-remover');
  await expect(page.locator('.header-benefits')).toContainText('Free uses 1/3');
  await chooseTestImage(page);
  await expect(page.locator('.hero-inner')).toHaveClass(/is-tool-expanded/);
  await expect(page.locator('.hero-copy')).toBeHidden();
  const expandedTool = await page.locator('.hero-tool').boundingBox();
  expect(expandedTool?.width).toBeGreaterThan(1000);
  await page.getByRole('button', { name: 'Remove background' }).click();

  await expect(page.locator('.background-result')).toBeVisible();
  const resultImage = page.locator('.background-result-stage img');
  await expect(resultImage).toHaveAttribute('src', 'https://results.test/background.png');
  await expect(page.locator('.background-result-stage')).toHaveClass(/is-transparent/);
  await page.getByRole('button', { name: 'Show original image' }).click();
  await expect(resultImage).toHaveAttribute('src', /^blob:/);
  await page.getByRole('button', { name: 'Show background-removed result' }).click();
  await expect(resultImage).toHaveAttribute('src', 'https://results.test/background.png');
  await expect(page.getByRole('heading', { name: 'Change background color' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download PNG' })).toBeVisible();
  const transparentDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PNG' }).click();
  await expect(inspectPngArtifact(await downloadBytes(await transparentDownload), { requireTransparency: true }))
    .resolves.toMatchObject({ hasTransparentPixel: true });
  await page.getByRole('button', { name: 'White background' }).click();
  const coloredDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PNG' }).click();
  await expect(inspectPngArtifact(await downloadBytes(await coloredDownload), { expectedOpaqueColor: [255, 255, 255] }))
    .resolves.toMatchObject({ matchesExpectedOpaqueColor: true });
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('Go to Editor')).toHaveCount(0);
  await expect(page.locator('.header-benefits')).toContainText('Free uses 0/3');
  expect(operation).toBe('background-removal');
});

test('background remover refreshes an expired result link without creating another job', async ({ page }) => {
  let jobReads = 0;
  let jobsCreated = 0;
  await page.route('**/api/auth/get-session', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ user: { id: 'google-user-1', name: 'Test User' }, session: { id: 'session-1' } }),
  }));
  await page.route('**/api/me/benefits', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ balance: 1, cap: 3, dailyReward: 1, checkedInToday: false }),
  }));
  await page.route('**/api/upload-url', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ url: 'https://uploads.test/refresh', key: uploadKey, expiresIn: 600 }),
  }));
  await page.route('https://uploads.test/refresh', (route) => route.fulfill({ status: 200 }));
  await page.route('**/api/jobs', (route) => {
    jobsCreated += 1;
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ id: jobId, status: 'completed' }),
    });
  });
  await page.route(`**/api/jobs/${jobId}`, (route) => {
    jobReads += 1;
    const refreshed = jobReads > 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'completed',
        resultUrl: refreshed ? 'https://results.test/refreshed.png' : 'https://results.test/expired.png',
        downloadUrl: refreshed ? 'https://results.test/refreshed-download.png' : 'https://results.test/expired-download.png',
      }),
    });
  });
  await page.route('https://results.test/expired.png', (route) => route.fulfill({ status: 403 }));
  await page.route('https://results.test/refreshed.png', (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: png,
  }));

  await page.goto('/background-remover');
  await chooseTestImage(page);
  await page.getByRole('button', { name: 'Remove background' }).click();

  const resultImage = page.locator('.background-result-stage img');
  await expect(resultImage).toHaveAttribute('src', 'https://results.test/refreshed.png');
  await expect(page.locator('.background-result')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(jobsCreated).toBe(1);
  expect(jobReads).toBe(2);
});

test('daily check-in grants one free use and then becomes unavailable for the day', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/auth/get-session', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ user: { id: 'google-user-1', name: 'Test User' }, session: { id: 'session-1' } }),
  }));
  await page.route('**/api/me/benefits', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ balance: 1, cap: 3, dailyReward: 1, checkedInToday: false }),
  }));
  await page.route('**/api/me/check-in', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ balance: 2, cap: 3, dailyReward: 1, checkedInToday: true, granted: true, balanceFull: false }),
  }));

  await page.goto('/');
  await expect(page.locator('.header-benefits')).toBeVisible();
  await page.getByRole('button', { name: 'Daily check-in +1' }).click();
  await expect(page.locator('.header-benefits')).toContainText('Free uses 2/3');
  await expect(page.getByRole('button', { name: 'Checked in today' })).toBeDisabled();
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
