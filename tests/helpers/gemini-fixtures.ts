import sharp from 'sharp';
import { getEmbeddedAlphaMap } from '../../src/vendor/gemini/engine.js';
export async function geminiImage(marked = true): Promise<Buffer> {
  const width = 1024; const height = 1024; const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) { pixels[i] = 64; pixels[i + 1] = 96; pixels[i + 2] = 128; pixels[i + 3] = 255; }
  pixels[3] = 0; pixels[7] = 128;
  if (marked) {
    const alpha = getEmbeddedAlphaMap(48);
    for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
      const a = alpha[y * 48 + x]; const i = ((height - 80 + y) * width + width - 80 + x) * 4;
      for (let c = 0; c < 3; c++) pixels[i + c] = Math.round(a * 255 + (1 - a) * pixels[i + c]);
    }
  }
  return sharp(Buffer.from(pixels), { raw: { width, height, channels: 4 } }).png().toBuffer();
}
