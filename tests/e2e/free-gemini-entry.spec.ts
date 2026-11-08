import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

for (const placement of ['hero', 'footer'] as const) for (const kind of ['image', 'video'] as const) {
  test(`${placement} Gemini entry carries the original ${kind} to its dedicated workspace`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: placement === 'footer' ? 390 : 1440, height: 1000 });
    await page.route('**/api/auth/get-session', route => route.fulfill({ json: null }));
    // The local tool remains usable when cloud capabilities cannot be read.
    await page.route('**/api/v1/capabilities', route => route.fulfill({ status: 503, json: {} }));
    const writes: string[] = [];
    page.on('request', request => { if (request.method() === 'POST' && /\/api\/v1\//.test(request.url())) writes.push(request.url()); });
    await page.goto('/gemini-watermark-remover');
    if (placement === 'footer') await page.locator('.site-cta').scrollIntoViewIfNeeded();
    const picker = page.getByTestId(placement === 'hero' ? 'media-launcher-file' : 'compact-launcher-file');
    await expect(picker).toBeEnabled();
    const original = kind === 'image' ? await sharp({ create: { width: 80, height: 60, channels: 3, background: '#8094a8' } }).png().toBuffer() : readFileSync(new URL('../fixtures/workspace-24fps.mp4', import.meta.url));
    await picker.setInputFiles({ name: `original.${kind === 'image' ? 'png' : 'mp4'}`, mimeType: kind === 'image' ? 'image/png' : 'video/mp4', buffer: original });
    await page.waitForURL(/\/app\/free\/gemini$/, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const preview = kind === 'image' ? page.getByAltText('Original image') : page.locator('.gemini-original video');
    await expect(preview).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: 'Sign in to process for free', exact: true })).toBeVisible();
    const source = await preview.getAttribute('src');
    expect(source).toMatch(/^blob:/);
    const digest = await page.evaluate(async url => {
      const bytes = await (await fetch(url!)).arrayBuffer();
      return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
    }, source);
    expect(digest).toBe(createHash('sha256').update(original).digest('hex'));
    expect(writes).toEqual([]);
  });
}
