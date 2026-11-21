import { expect, test, type Locator } from '@playwright/test';

const route = '/nano-banana-watermark-remover';
const hero = '[data-landing-preview]:visible';
const features = '.landing-features-section .feature-media';

async function expectFullFrame(display: Locator, ratio: number) {
  await display.scrollIntoViewIfNeeded();
  await expect(display).toHaveAttribute('data-ready', 'true');
  await expect(display.getByRole('slider')).toHaveValue('50');
  const frame = (await display.locator('.image-display-controls').boundingBox())!;
  expect(Math.abs(frame.width / frame.height - ratio)).toBeLessThan(0.015);
  for (const image of await display.locator('img').all()) {
    const box = (await image.boundingBox())!;
    expect(Math.abs(box.width - frame.width)).toBeLessThan(1);
    expect(Math.abs(box.height - frame.height)).toBeLessThan(1);
  }
}

for (const width of [1491, 390]) {
  test(`Nano Banana displays every comparison uncropped at ${width}px with reduced motion`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(route, { waitUntil: 'domcontentloaded' });

    const samples = page.locator('[data-landing-sample]');
    await expect(samples).toHaveCount(3);
    for (let index = 0; index < 3; index++) {
      if (index) await samples.nth(index).click();
      const frame = page.locator(`${hero} .landing-sample-image`);
      await expectFullFrame(frame.locator('[data-image-display]'), 538 / 436);
      expect((await frame.boundingBox())!.height).toBeCloseTo(width === 390 ? 240 : 400, 0);
    }

    const cards = page.locator(features);
    await expect(cards).toHaveCount(4);
    for (const card of await cards.all()) {
      await expectFullFrame(card.locator('[data-image-display]'), 640 / 347);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test('Nano Banana demonstrates visible comparisons again on re-entry and stops on hover', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const time = new Date();
  await page.clock.install({ time });
  await page.clock.pauseAt(new Date(time.getTime() + 10_000));
  await page.goto(route, { waitUntil: 'domcontentloaded' });

  const display = page.locator(`${hero} [data-image-display]`);
  await display.scrollIntoViewIfNeeded();
  const slider = display.getByRole('slider');
  const feature = page.locator(`${features} [data-image-display]`).first();
  await expect(slider).toBeVisible();
  await expect(slider).toHaveValue('50');
  await expect.poll(async () => {
    await page.clock.runFor(100);
    return Number(await slider.inputValue());
  }).toBeGreaterThan(80);
  await expect(feature.locator('input')).toHaveValue('50');

  await display.hover();
  const stopped = await slider.inputValue();
  await page.mouse.move(0, 0);
  await page.clock.runFor(3200);
  await expect(slider).toHaveValue(stopped);
  await slider.press('Home');
  await expect(slider).toHaveValue('0');
  await slider.press('End');
  await expect(slider).toHaveValue('100');
  const track = (await display.locator('.image-display-controls').boundingBox())!;
  await page.mouse.click(track.x + track.width * 0.75, track.y + track.height / 2);
  expect(Math.abs(Number(await slider.inputValue()) - 75)).toBeLessThanOrEqual(1);
  await page.mouse.move(0, 0);

  await feature.scrollIntoViewIfNeeded();
  const featureSlider = feature.getByRole('slider');
  await expect(featureSlider).toBeVisible();
  await expect.poll(async () => {
    await page.clock.runFor(100);
    return Number(await featureSlider.inputValue());
  }).toBeGreaterThan(80);
  await page.clock.runFor(3200);
  await expect(featureSlider).toHaveValue('50');
  await display.scrollIntoViewIfNeeded();
  await expect(feature).not.toBeInViewport();
  await feature.scrollIntoViewIfNeeded();
  await expect.poll(async () => {
    await page.clock.runFor(100);
    return Number(await featureSlider.inputValue());
  }).toBeGreaterThan(80);
  await page.clock.runFor(3200);
  await expect(featureSlider).toHaveValue('50');
});
