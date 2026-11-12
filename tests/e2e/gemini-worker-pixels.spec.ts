import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { localOperationCatalog } from '../../src/lib/contracts/operation-catalog';

// Isolate the Worker's native ImageData -> Canvas -> PNG boundary from detection.
// Full processing and downloads use the real engine in free-gemini.spec.ts.
for (const [width, height] of [[1024, 1024], [8000, 5000]]) {
  test(`reusing RGBA pixels preserves PNG output at ${width}x${height}`, async ({ page }) => {
    test.setTimeout(120_000);
    expect(width * height).toBeLessThanOrEqual(localOperationCatalog['gemini-image-free'].capability.maxPixels);
    await page.route('**/api/auth/get-session', route => route.fulfill({ json: null }));
    await page.goto('/app/free/gemini');
    const results = await page.evaluate(async ({ width, height }) => {
      const pixels = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < pixels.length; i += 4) pixels.set([64, 96, 128, 255], i);
      pixels[3] = 0; pixels[7] = 128;
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d')!;
      async function png(copy: boolean) {
        const image = new ImageData(copy ? new Uint8ClampedArray(pixels) : pixels, width, height);
        const reused = image.data === pixels;
        context.putImageData(image, 0, 0);
        const blob = await canvas.convertToBlob({ type: 'image/png' });
        return { reused, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) };
      }
      const copied = await png(true);
      const reused = await png(false);
      canvas.width = canvas.height = 1;
      return { copied, reused };
    }, { width, height });
    expect(results.copied.reused).toBe(false);
    expect(results.reused.reused).toBe(true);
    const before = await sharp(Buffer.from(results.copied.bytes)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const after = await sharp(Buffer.from(results.reused.bytes)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(after.info).toMatchObject({ width, height, channels: 4 });
    expect(after.data.equals(before.data)).toBe(true);
    expect(after.data[3]).toBe(0);
    expect(after.data[7]).toBe(128);
  });
}
