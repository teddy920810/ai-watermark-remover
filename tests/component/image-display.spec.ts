import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const loadingMessage = 'Loading comparison…';

test('preserves the configured alt verbatim for both image sources', async ({ page }) => {
  await page.goto('/');
  const images = page.locator('#pair img');
  await expect(images).toHaveCount(2);
  const alt = await images.first().getAttribute('alt');
  expect(alt).toBeTruthy();
  await expect(images.nth(1)).toHaveAttribute('alt', alt!);
});

test('preserves independent operator descriptions for Before and After', async ({ page }) => {
  await page.goto('/');
  const images = page.locator('#distinct-alt img');
  await expect(images).toHaveCount(2);
  await expect(images.nth(0)).toHaveAttribute('alt', 'Operator Before description');
  await expect(images.nth(1)).toHaveAttribute('alt', 'Operator After description');
});

test('a deferred comparison enables Before and After when it comes into view', async ({ page }) => {
  let afterLoaded = false;
  let releaseBefore!: () => void;
  const beforeMayLoad = new Promise<void>(resolve => { releaseBefore = resolve; });
  await page.route('**/*warm-after=1', async route => {
    await route.fulfill({ contentType: 'image/png', body: readFileSync('public/uploads/home-blueprint/features/hero-sample-02-sunset.png') });
    afterLoaded = true;
  });
  await page.route('**/*cold-before=1', async route => {
    await beforeMayLoad;
    await route.fulfill({ contentType: 'image/png', body: readFileSync('public/uploads/home-blueprint/features/hero-sample-01-serum.png') });
  });
  const display = page.locator('#after-first [data-image-display]');
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(afterLoaded).toBe(false);
    await display.scrollIntoViewIfNeeded();
    await expect.poll(() => afterLoaded).toBe(true);
    await expect(display.getByText(loadingMessage)).toBeVisible();
    await expect(display.getByRole('slider')).toHaveCount(0);
  } finally {
    releaseBefore();
  }
  await expect(display).toHaveAttribute('data-ready', 'true');
  await expect(display.getByText(loadingMessage)).toBeHidden();
  await expect(display.getByRole('slider')).toHaveValue('50');
});

test('switching Hero samples starts the selected pair and keeps its loading state independent', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // Do not let the viewport observer start Hero requests on behalf of the click handler.
  await page.addInitScript(() => {
    const NativeObserver = window.IntersectionObserver;
    window.IntersectionObserver = class extends NativeObserver {
      override observe(target: Element) { if (!target.closest('#hero')) super.observe(target); }
    };
  });
  const requested = new Set<string>();
  let releaseSecond!: () => void;
  let releaseThird!: () => void;
  const secondMayLoad = new Promise<void>(resolve => { releaseSecond = resolve; });
  const thirdMayFail = new Promise<void>(resolve => { releaseThird = resolve; });
  await page.route(/\?hero-(before|after)=[12]$/, async route => {
    const sample = new URL(route.request().url()).search;
    requested.add(sample);
    if (sample === '?hero-after=1') await secondMayLoad;
    if (sample === '?hero-after=2') {
      await thirdMayFail;
      await route.abort();
    } else await route.continue();
  });

  const previews = page.locator('#hero [data-landing-preview]');
  const second = previews.nth(1).locator('[data-image-display]');
  const third = previews.nth(2).locator('[data-image-display]');
  try {
    await page.goto('/');
    await expect(page.locator('#hero')).toHaveAttribute('data-landing-initialized', 'true');
    expect(requested.size).toBe(0);
    await page.getByRole('button', { name: 'Second Hero' }).click();
    await expect.poll(() => [...requested].sort(), { timeout: 4000 }).toEqual(['?hero-after=1', '?hero-before=1']);
    await expect(second.getByText(loadingMessage)).toBeVisible();

    await page.getByRole('button', { name: 'Third Hero' }).click();
    await expect(third.getByText(loadingMessage)).toBeVisible();
    releaseSecond();
    await expect(second).toHaveAttribute('data-ready', 'true');
    await expect(third.getByText(loadingMessage)).toBeVisible();
    releaseThird();
    await expect(third.getByText(loadingMessage)).toBeHidden();
    await expect(third.locator('[data-image-side]:visible')).toHaveCount(1);
    await expect(third.getByRole('slider')).toHaveCount(0);

    await page.getByRole('button', { name: 'Second Hero' }).click();
    await expect(second.getByRole('slider')).toHaveValue('50');
    await expect(second.getByText(loadingMessage)).toBeHidden();
    expect(requested.size).toBe(4);
  } finally {
    releaseSecond();
    releaseThird();
  }
});

test('zero and single images never expose comparison controls; a failed pair degrades to its loaded source', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#zero [data-image-display]')).toHaveCount(0);
  await expect(page.locator('#single img')).toHaveCount(1);
  await expect(page.locator('#single input, #single .image-display-label, #single .image-display-divider')).toHaveCount(0);
  await expect(page.locator('#single').getByText(loadingMessage)).toHaveCount(0);
  for (const id of ['before-failed', 'after-failed', 'unaligned']) {
    await expect(page.locator(`#${id} [data-image-display]`)).toHaveAttribute('data-ready', 'false');
    await expect(page.locator(`#${id} input`)).toBeHidden();
    await expect(page.locator(`#${id}`).getByText(loadingMessage)).toBeHidden();
    await expect(page.locator(`#${id} [data-image-side]:visible`)).toHaveCount(1);
  }
  await expect(page.locator('#both-failed').getByRole('status').filter({ hasText: 'The image could not be loaded.' })).toBeVisible();
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
