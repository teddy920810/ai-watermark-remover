import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('preserves the configured alt verbatim for both image sources', async ({ page }) => {
  await page.goto('/');
  const images = page.locator('#pair img');
  await expect(images).toHaveCount(2);
  const alt = await images.first().getAttribute('alt');
  expect(alt).toBeTruthy();
  await expect(images.nth(1)).toHaveAttribute('alt', alt!);
});

test('a cold Before remains loadable after its After has already loaded offscreen', async ({ page }) => {
  let afterLoaded = false;
  await page.route('**/*warm-after=1', async route => {
    await route.fulfill({ contentType: 'image/png', body: readFileSync('public/uploads/home-blueprint/features/hero-sample-02-sunset.png') });
    afterLoaded = true;
  });
  await page.route('**/*cold-before=1', async route => {
    await expect.poll(() => afterLoaded).toBe(true);
    await route.fulfill({ contentType: 'image/png', body: readFileSync('public/uploads/home-blueprint/features/hero-sample-01-serum.png') });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => afterLoaded).toBe(true);
  const display = page.locator('#after-first [data-image-display]');
  await display.scrollIntoViewIfNeeded();
  await expect(display).toHaveAttribute('data-ready', 'true');
  await expect(display.getByRole('slider')).toHaveValue('50');
});

test('zero and single images never expose comparison controls; a failed pair degrades to its loaded source', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#zero [data-image-display]')).toHaveCount(0);
  await expect(page.locator('#single img')).toHaveCount(1);
  await expect(page.locator('#single input, #single .image-display-label, #single .image-display-divider')).toHaveCount(0);
  for (const id of ['before-failed', 'after-failed', 'unaligned']) {
    await expect(page.locator(`#${id} [data-image-display]`)).toHaveAttribute('data-ready', 'false');
    await expect(page.locator(`#${id} input`)).toBeHidden();
    await expect(page.locator(`#${id} [data-image-side]:visible`)).toHaveCount(1);
  }
  await expect(page.locator('#both-failed [role="status"]')).toBeVisible();
});

test('a real aligned pair supports 0/50/100, keyboard, pointer capture, touch and switch reset', async ({ page }) => {
  await page.goto('/');
  const display = page.locator('#pair [data-image-display]');
  const range = display.getByRole('slider');
  await display.scrollIntoViewIfNeeded();
  await expect(display).toHaveAttribute('data-ready', 'true');
  await expect(range).toHaveValue('50');
  await range.focus(); await range.press('Home'); await expect(range).toHaveValue('0');
  await range.press('End'); await expect(range).toHaveValue('100');
  await range.press('ArrowLeft'); await expect(range).toHaveValue('99');
  const box = (await range.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x - 20, box.y + box.height / 2); await page.mouse.up();
  await expect(range).toHaveValue('0');
  await page.touchscreen.tap(box.x + box.width * 0.75, box.y + box.height / 2);
  expect(Number(await range.inputValue())).toBeCloseTo(75, 0);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  const cancelledValue = await range.inputValue();
  await display.locator('.image-display-controls').dispatchEvent('pointercancel', { pointerId: 1 });
  await page.mouse.move(box.x, box.y + box.height / 2); await page.mouse.up();
  await expect(range).toHaveValue(cancelledValue);
  await page.getByRole('button', { name: 'Switch sample' }).click();
  await expect(range).toHaveValue('50');
  await expect(display.locator('[data-image-side="before"]')).toHaveCSS('clip-path', 'inset(0px 50% 0px 0px)');
  const framed = page.locator('#cover [data-image-display]');
  await expect(framed).toHaveAttribute('data-ready', 'true');
  for (const side of ['before', 'after']) {
    const image = framed.locator(`[data-image-side="${side}"] img`);
    await expect(image).toHaveCSS('object-fit', 'cover');
    expect((await image.boundingBox())!.height).toBe(240);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
