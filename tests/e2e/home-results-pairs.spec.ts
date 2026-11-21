import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const home = JSON.parse(readFileSync(new URL('../../src/content/homepage/home.json', import.meta.url), 'utf8'));

for (const width of [1440, 390]) {
  test(`homepage results: all five pairs load, drag and reset at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const section = page.locator('[data-scenario-section]');
    await section.scrollIntoViewIfNeeded();
    const tabs = section.getByRole('tab');
    await expect(tabs).toHaveCount(5);
    for (let index = 0; index < home.useCases.length; index++) {
      const item = home.useCases[index];
      await tabs.nth(index).click();
      const display = section.locator('[data-scenario-panel]:visible [data-image-display]');
      await display.scrollIntoViewIfNeeded();
      await expect(display).toHaveAttribute('data-pair', 'true');
      await expect(display).toHaveAttribute('data-ready', 'true');
      for (const [side, source, alt] of [['before', item.image, item.imageAlt], ['after', item.afterImage, item.afterImageAlt ?? item.imageAlt]]) {
        const image = display.locator(`[data-image-side="${side}"] img`);
        await expect(image).toHaveAttribute('src', source);
        await expect(image).toHaveAttribute('alt', alt);
        await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        await expect(image).not.toHaveAttribute('data-image-fallback', 'true');
      }
      const slider = display.getByRole('slider');
      await expect(slider).toHaveValue('50');
      const box = await display.boundingBox();
      if (!box) throw new Error('Result comparison has no visible bounds');
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
      await tabs.nth((index + 1) % home.useCases.length).click();
      await tabs.nth(index).click();
      await expect(slider).toHaveValue('50');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.locator('.fixed-watermark,.home-demo-watermark')).toHaveCount(0);
  });
}
