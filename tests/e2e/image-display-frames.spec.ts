import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) test(`shared static images fill their existing marketing frames at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.route('**/api/auth/get-session', route => route.fulfill({ json: null }));
  await page.route('**/api/v1/capabilities', route => route.fulfill({ json: { operations: [] } }));
  for (const [path, selectors] of [
    ['/', ['.process-step-media', '.case-media', '.tool-media']],
    ['/remove-text-from-image', ['.process-step-media']],
  ] as const) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    for (const selector of selectors) {
      const frame = page.locator(selector).first();
      const image = frame.locator('.image-display img').first();
      await frame.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      const dimensions = await frame.evaluate(element => ({ frame: element.clientHeight, image: element.querySelector('img')!.getBoundingClientRect().height }));
      expect(Math.abs(dimensions.image - dimensions.frame), `${path} ${selector}: nested images must retain the original cover frame`).toBeLessThanOrEqual(1);
    }
  }
});

for (const [width, frameRatio] of [[1440, 8 / 5], [390, 35 / 24]]) test(`tool Hero preserves the comparison image and aligns its controls at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.route('**/api/auth/get-session', route => route.fulfill({ json: null }));
  await page.route('**/api/v1/capabilities', route => route.fulfill({ json: { operations: [] } }));
  await page.goto('/remove-text-from-image', { waitUntil: 'domcontentloaded' });

  const frame = page.locator('.landing-sample-image').first();
  const controls = frame.locator('.image-display-controls');
  await expect(controls).toBeVisible();
  const bounds = await frame.evaluate(element => ({
    frame: element.getBoundingClientRect().toJSON(),
    controls: element.querySelector('.image-display-controls')!.getBoundingClientRect().toJSON(),
    images: Array.from(element.querySelectorAll<HTMLImageElement>('.image-display img'), image => ({
      box: image.getBoundingClientRect().toJSON(),
      fit: getComputedStyle(image).objectFit,
      sourceRatio: image.naturalWidth / image.naturalHeight,
    })),
  }));
  expect(bounds.frame.width / bounds.frame.height).toBeCloseTo(frameRatio, 2);
  expect(bounds.controls.height).toBeLessThan(bounds.frame.height);
  expect(bounds.images).toHaveLength(2);
  for (const { box, fit, sourceRatio } of bounds.images) {
    expect(fit).toBe('contain');
    expect(box.width / box.height).toBeCloseTo(sourceRatio, 2);
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expect(Math.abs(box[key] - bounds.controls[key]), `image and controls align on ${key}`).toBeLessThanOrEqual(1);
    }
  }
});
