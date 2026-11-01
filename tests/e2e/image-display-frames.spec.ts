import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) test(`shared static images fill their existing marketing frames at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.route('**/api/auth/get-session', route => route.fulfill({ json: null }));
  await page.route('**/api/v1/capabilities', route => route.fulfill({ json: { operations: [] } }));
  for (const [path, selectors] of [
    ['/', ['.process-step-media', '.case-media', '.tool-media']],
    ['/remove-text-from-image', ['.process-step-media', '.landing-sample-image']],
  ] as const) {
    await page.goto(path);
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
