import { describe, expect, it } from 'vitest';
import { getEmbeddedAlphaMap, removeWatermarkFromImageDataSync } from '../../vendor/gemini/engine.js';

describe('pinned Gemini image engine', () => {
  it('removes a calibrated visible mark without changing pixels outside its region', () => {
    const width = 1024; const height = 1024; const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 4) { data[i] = 64; data[i + 1] = 96; data[i + 2] = 128; data[i + 3] = 255; }
    const alpha = getEmbeddedAlphaMap(48); const x = width - 80; const y = height - 80;
    for (let row = 0; row < 48; row++) for (let col = 0; col < 48; col++) {
      const a = alpha[row * 48 + col]; const at = ((y + row) * width + x + col) * 4;
      for (let c = 0; c < 3; c++) data[at + c] = Math.round(a * 255 + (1 - a) * data[at + c]);
    }
    const result = removeWatermarkFromImageDataSync({ width, height, data });
    expect(result.meta.applied).toBe(true);
    let error = 0; let outsideError = 0;
    for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
      const at = (row * width + col) * 4;
      const inside = row >= y && row < y + 48 && col >= x && col < x + 48;
      for (let c = 0; c < 3; c++) {
        if (!inside) outsideError = Math.max(outsideError, Math.abs(result.imageData.data[at + c] - [64, 96, 128][c]));
        else error += Math.abs(result.imageData.data[at + c] - [64, 96, 128][c]);
      }
    }
    expect(error / (48 * 48 * 3)).toBeLessThan(2);
    expect(outsideError).toBe(0);
  }, 120_000);
  it('leaves an unwatermarked image intact instead of producing a success', () => {
    const data = new Uint8ClampedArray(256 * 256 * 4).fill(255);
    const result = removeWatermarkFromImageDataSync({ width: 256, height: 256, data });
    expect(result.meta.applied).toBe(false);
    expect(result.imageData.data).toEqual(data);
  }, 30_000);
});
