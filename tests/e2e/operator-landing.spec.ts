import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('operator copy renders supplied card titles, descriptions and links on desktop and mobile', async ({ page }) => {
  const copy = JSON.parse(readFileSync('src/content/landing-pages/remove-logo-from-image.json', 'utf8'));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/remove-logo-from-image', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('h1')).toHaveText(copy.heading);
    await expect(page.locator('.hero-tool .tool-note')).toHaveText(copy.toolNote);
    const tools = page.locator('#ai-tools .tool-card');
    await expect(tools).toHaveCount(8);
    for (const [index, item] of copy.relatedTools.items.entries()) {
      await expect(tools.nth(index).locator('h3')).toHaveText(item.title);
      await expect(tools.nth(index).locator('p')).toHaveText(item.description);
      await expect(tools.nth(index)).toHaveAttribute('href', item.href);
    }
    const guides = page.locator('#guides li a');
    await expect(guides).toHaveCount(6);
    for (const [index, item] of copy.guides.items.entries()) {
      await expect(guides.nth(index)).toContainText(item.title);
      await expect(guides.nth(index)).toHaveAttribute('href', item.href);
    }
    await expect(page.locator('.feature-item')).toHaveCount(4);
    await expect(page.locator('.faq-list details')).toHaveCount(11);
    await page.locator('.site-cta').scrollIntoViewIfNeeded();
    await expect(page.locator('.site-cta button')).toHaveText(copy.cta.buttonLabel);
    await expect(page.locator('.site-cta [data-testid="compact-launcher-file"]')).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});

test('unmodified tools retain their automatic cards and upload control', async ({ page }) => {
  await page.goto('/remove-background');
  await expect(page.locator('#ai-tools .tool-card')).not.toHaveCount(0);
  await page.locator('.site-cta').scrollIntoViewIfNeeded();
  await expect(page.locator('.site-cta [data-testid="compact-launcher-file"]')).toBeEnabled();
  await expect(page.locator('.tool-note')).toHaveCount(0);
});
