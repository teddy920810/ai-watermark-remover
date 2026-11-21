import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const home = JSON.parse(readFileSync(new URL('../../src/content/homepage/home.json', import.meta.url), 'utf8'));

for (const width of [1440, 390]) {
  test(`homepage features: all four pairs load and drag at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const cards = page.locator('.features-section .feature-item');
    await expect(cards).toHaveCount(4);
    for (let index = 0; index < home.features.items.length; index++) {
      const item = home.features.items[index];
      const display = cards.nth(index).locator('[data-image-display]');
      await display.scrollIntoViewIfNeeded();
      await expect(display).toHaveAttribute('data-pair', 'true');
      await expect(display).toHaveAttribute('data-ready', 'true');
      for (const [side, source] of [['before', item.image], ['after', item.afterImage]]) {
        const image = display.locator(`[data-image-side="${side}"] img`);
        await expect(image).toHaveAttribute('src', source);
        await expect(image).toHaveAttribute('alt', item.imageAlt);
        await expect(image).not.toHaveAttribute('data-image-fallback', 'true');
        await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      }
      const slider = display.getByRole('slider');
      await expect(slider).toHaveValue('50');
      const box = await display.boundingBox();
      if (!box) throw new Error('Feature comparison has no visible bounds');
      for (const position of [20, 80]) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * position / 100, box.y + box.height / 2, { steps: 4 });
        await page.mouse.up();
        await expect.poll(async () => Math.abs(Number(await slider.inputValue()) - position)).toBeLessThan(2);
      }
      await slider.press('Home');
      await expect(slider).toHaveValue('0');
      await slider.press('End');
      await expect(slider).toHaveValue('100');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
