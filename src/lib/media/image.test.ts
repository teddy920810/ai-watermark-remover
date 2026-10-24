import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { inspectImage, inspectMask, prepareImageForProvider } from './image';

const png = (width = 4, height = 2) => sharp({ create: { width, height, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer();

describe('server image verification and JPEG preparation', () => {
  it('inspects actual bytes and alpha rather than a filename/MIME claim', async () => {
    const bytes = await png();
    await expect(inspectImage(bytes)).resolves.toMatchObject({ mimeType: 'image/png', format: 'png', width: 4, height: 2, encodedWidth: 4, encodedHeight: 2, hasAlpha: true, bytes: bytes.byteLength });
    await expect(inspectImage(Buffer.from('pretend image'))).rejects.toThrow('Image is invalid or unsupported');
  });
  it('decodes pixels so a truncated body with a valid header is rejected', async () => {
    const bytes = await png(100, 100);
    await expect(inspectImage(bytes.subarray(0, 50))).rejects.toThrow('Image is invalid or unsupported');
  });
  it('rejects byte and pixel limits before processing', async () => {
    const bytes = await png();
    await expect(inspectImage(bytes, { maxBytes: 2 })).rejects.toThrow('Image exceeds the byte limit');
    await expect(inspectImage(bytes, { maxPixels: 3 })).rejects.toThrow('Image is invalid or unsupported');
  });
  it('normalizes orientation, caps dimensions without enlargement, converts to JPEG and reports actual output', async () => {
    const source = await sharp({ create: { width: 8, height: 4, channels: 3, background: '#ffffff' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    expect(await inspectImage(source)).toMatchObject({ encodedWidth: 8, encodedHeight: 4, width: 4, height: 8, orientation: 6 });
    const prepared = await prepareImageForProvider(source, { maxDimension: 4 });
    expect(prepared.info).toMatchObject({ format: 'jpeg', mimeType: 'image/jpeg', width: 2, height: 4, hasAlpha: false });
    expect(prepared.source).toMatchObject({ width: 4, height: 8 });
    const small = await prepareImageForProvider(await png(), { maxDimension: 6000 });
    expect(small.info).toMatchObject({ width: 4, height: 2 });
    expect(small.converted).toBe(true);
  });
  it('flattens alpha explicitly over white instead of promising transparency retention', async () => {
    const source = await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const prepared = await prepareImageForProvider(source);
    const pixel = await sharp(prepared.bytes).raw().toBuffer();
    expect([...pixel.subarray(0, 3)]).toEqual([255, 255, 255]);
  });
});

describe('binary PNG mask validation', () => {
  const binaryMask = () => sharp(Buffer.from([0, 255, 0, 0]), { raw: { width: 2, height: 2, channels: 1 } }).png().toBuffer();
  it('checks native dimensions and counts binary regions without changing the mask', async () => {
    await expect(inspectMask(await binaryMask(), { width: 2, height: 2 })).resolves.toEqual({ width: 2, height: 2, whitePixels: 1, blackPixels: 3 });
  });
  it('rejects wrong dimensions, non-PNG, empty white region, and nonbinary/transparent masks', async () => {
    await expect(inspectMask(await binaryMask(), { width: 3, height: 2 })).rejects.toThrow('Mask dimensions do not match the input');
    const gray = await sharp(Buffer.from([0, 128, 0, 0]), { raw: { width: 2, height: 2, channels: 1 } }).png().toBuffer();
    const empty = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#000000' } }).png().toBuffer();
    const jpg = await sharp(empty).jpeg().toBuffer();
    await expect(inspectMask(gray, { width: 2, height: 2 })).rejects.toThrow('Mask must contain opaque black and white pixels');
    await expect(inspectMask(await png(2, 2), { width: 2, height: 2 })).rejects.toThrow('Mask must contain opaque black and white pixels');
    await expect(inspectMask(empty, { width: 2, height: 2 })).rejects.toThrow('Mask contains no white region');
    await expect(inspectMask(jpg, { width: 2, height: 2 })).rejects.toThrow('Mask must be a PNG image');
  });
});
