import { expect, test } from '@playwright/test';

test('homepage has one upload entry aligned with the example on desktop and readable on mobile', async ({ page }) => {
  await page.route('**/api/auth/get-session', route => route.fulfill({ json: null }));
  await page.route('**/api/v1/capabilities', route => route.fulfill({ json: { operations: [] } }));
  for (const width of [1864, 1280, 1024, 768, 390, 360]) {
    await page.setViewportSize({ width, height: width > 1000 ? 957 : 844 });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Upload file', exact: true })).toBeEnabled();
    await expect(page.locator('#tool .launcher-modes')).toHaveCount(0);
    await expect(page.locator('#tool .launcher-requirements')).toContainText('MP4');
    const input = page.getByTestId('media-launcher-file');
    await expect(input).toHaveAttribute('accept', /image\/jpeg/);
    await expect(input).toHaveAttribute('accept', /video\/mp4/);
    const example = await page.locator('.compare-panel [data-hero-preview="0"] .home-compare').boundingBox();
    const upload = await page.locator('#tool .launcher-drop').boundingBox();
    expect(example).toBeTruthy();
    expect(upload).toBeTruthy();
    if (width > 920) expect(Math.abs(example!.y - upload!.y), `top alignment at ${width}px`).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `page overflow at ${width}px`).toBeLessThanOrEqual(width);
    const button = await page.getByRole('button', { name: 'Upload file', exact: true }).boundingBox();
    expect(button!.height).toBeGreaterThanOrEqual(44);
    expect(button!.x).toBeGreaterThanOrEqual(0);
    expect(button!.x + button!.width).toBeLessThanOrEqual(width);
  }
});

test('image-specific background removal keeps its own upload and workspace controls stay separate', async ({ page }) => {
  await page.route('**/api/auth/get-session', route => route.fulfill({ json: null }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/remove-background');
  await expect(page.locator('.home-blueprint')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Upload file', exact: true })).toHaveCount(0);
  await expect(page.locator('input[type=file]')).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp,.jfif');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
