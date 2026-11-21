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
  const frameBounds = (await frame.boundingBox())!;
  const controlBounds = (await controls.boundingBox())!;
  expect(frameBounds.width / frameBounds.height).toBeCloseTo(frameRatio, 2);
  expect(controlBounds.height).toBeLessThan(frameBounds.height);

  for (const side of ['before', 'after']) {
    const image = frame.locator(`[data-image-side="${side}"] img`);
    await expect(image).toHaveCSS('object-fit', 'contain');
    const { box, sourceRatio } = await image.evaluate((element: HTMLImageElement) => ({
      box: element.getBoundingClientRect().toJSON(),
      sourceRatio: element.naturalWidth / element.naturalHeight,
    }));
    expect(box.width / box.height).toBeCloseTo(sourceRatio, 2);
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expect(Math.abs(box[key] - controlBounds[key])).toBeLessThanOrEqual(1);
    }
  }
});
