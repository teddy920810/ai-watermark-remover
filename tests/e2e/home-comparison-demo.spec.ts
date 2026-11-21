import { expect, test, type Page } from '@playwright/test';

const hero = '[data-hero-preview]:visible [data-image-display]';

test('homepage Hero clips both comparison layers to rounded corners on desktop and mobile', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const display = page.locator(hero);
    const slider = display.getByRole('slider');
    await display.scrollIntoViewIfNeeded();
    await expect(slider).toBeVisible();
    await expect(display).toHaveCSS('border-radius', '18px');
    await expect(display).toHaveCSS('overflow', 'hidden');

    for (const endpoint of ['Home', 'End']) {
      await slider.press(endpoint);
      const clipsCorner = await display.evaluate(element => {
        const { left, top } = element.getBoundingClientRect();
        return !element.contains(document.elementFromPoint(left + 1, top + 1));
      });
      expect(clipsCorner).toBe(true);
    }
  }
});

async function openWithClock(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1040 });
  const start = new Date();
  await page.clock.install({ time: start });
  await page.clock.pauseAt(new Date(start.getTime() + 10_000));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
}

test('homepage comparison shows its focus outline for keyboard use only', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const display = page.locator(hero);
  const slider = display.getByRole('slider');
  await expect(slider).toBeVisible();
  await slider.focus();
  await expect(display).toHaveCSS('outline-style', 'solid');

  const track = (await slider.boundingBox())!;
  await page.mouse.click(track.x + track.width * 0.75, track.y + track.height / 2);
  await expect(slider).toHaveValue('75');
  await expect(display).toHaveCSS('outline-style', 'none');

  await page.keyboard.press('ArrowLeft');
  await expect(slider).toHaveValue('74');
  await expect(display).toHaveCSS('outline-style', 'solid');
});

test('homepage Hero replays after scrolling away and settles in the center', async ({ page }) => {
  await openWithClock(page);
  const display = page.locator(hero);
  const slider = display.getByRole('slider');
  await display.scrollIntoViewIfNeeded();
  await expect(slider).toBeVisible();
  const initial = await slider.getAttribute('value');
  await expect.poll(async () => {
    await page.clock.runFor(100);
    return slider.inputValue();
  }).not.toBe(initial);

  await display.hover();
  const stopped = await slider.inputValue();
  await page.mouse.move(0, 0);
  await page.clock.runFor(3200);
  await expect(slider).toHaveValue(stopped);

  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
  await expect(display).not.toBeInViewport();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect(display).toBeInViewport({ ratio: 0.5 });
  await expect.poll(async () => {
    await page.clock.runFor(100);
    const value = await slider.inputValue();
    return value !== stopped && Number(value) > 80;
  }).toBe(true);
  await page.clock.runFor(1600);
  await expect(slider).not.toHaveValue('50');
  await page.clock.runFor(1600);
  await expect(slider).toHaveValue('50');
});

test('both homepage Features demonstrate when they share the viewport', async ({ page }) => {
  await openWithClock(page);
  const displays = page.locator('.features-section .feature-media [data-image-display]');
  const first = displays.nth(0);
  const second = displays.nth(1);
  await first.evaluate(element => window.scrollTo({ top: scrollY + element.getBoundingClientRect().top - 125, behavior: 'instant' }));
  await expect(first).toBeInViewport({ ratio: 0.5 });
  await expect(second).toBeInViewport({ ratio: 0.5 });

  const sliders = [first.getByRole('slider'), second.getByRole('slider')];
  for (const slider of sliders) await expect(slider).toBeVisible();
  const initial = await Promise.all(sliders.map(slider => slider.getAttribute('value')));
  const moved = [false, false];
  await expect.poll(async () => {
    await page.clock.runFor(100);
    for (const [index, slider] of sliders.entries()) {
      moved[index] ||= await slider.inputValue() !== initial[index];
    }
    return moved;
  }).toEqual([true, true]);
  await page.clock.runFor(3200);
  for (const slider of sliders) await expect(slider).toHaveValue('50');
});
