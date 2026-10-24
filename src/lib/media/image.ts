import sharp from 'sharp';

export interface ImageInfo {
  format: 'jpeg' | 'png' | 'webp';
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number;
  height: number;
  encodedWidth: number;
  encodedHeight: number;
  hasAlpha: boolean;
  orientation?: number;
  bytes: number;
}
export interface ImageLimits { maxBytes?: number; maxPixels?: number }

function checkBytes(bytes: Uint8Array, limit: number): void {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('Image byte limit is invalid');
  if (!bytes.byteLength) throw new Error('Image is invalid or unsupported');
  if (bytes.byteLength > limit) throw new Error('Image exceeds the byte limit');
}

export async function inspectImage(bytes: Uint8Array, limits: ImageLimits = {}): Promise<ImageInfo> {
  checkBytes(bytes, limits.maxBytes ?? 10 * 1024 * 1024);
  const maxPixels = limits.maxPixels ?? 40_000_000;
  if (!Number.isSafeInteger(maxPixels) || maxPixels <= 0) throw new Error('Image pixel limit is invalid');
  try {
    const image = sharp(bytes, { failOn: 'error', limitInputPixels: maxPixels, animated: true });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || !['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) !== 1) throw new Error();
    // Header metadata alone accepts some corrupt/truncated images. Decode pixels.
    await image.stats();
    const format = metadata.format as ImageInfo['format'];
    const rotated = metadata.orientation !== undefined && metadata.orientation >= 5;
    return {
      format, mimeType: `image/${format}` as ImageInfo['mimeType'],
      width: rotated ? metadata.height : metadata.width,
      height: rotated ? metadata.width : metadata.height,
      encodedWidth: metadata.width, encodedHeight: metadata.height,
      hasAlpha: metadata.hasAlpha ?? false,
      ...(metadata.orientation ? { orientation: metadata.orientation } : {}),
      bytes: bytes.byteLength,
    };
  } catch {
    throw new Error('Image is invalid or unsupported');
  }
}

export async function prepareImageForProvider(bytes: Uint8Array, options: ImageLimits & { maxDimension?: number } = {}): Promise<{ bytes: Uint8Array; info: ImageInfo; source: ImageInfo; converted: boolean }> {
  const source = await inspectImage(bytes, options);
  const maxDimension = options.maxDimension ?? 6000;
  if (!Number.isInteger(maxDimension) || maxDimension <= 0 || maxDimension > 6000) throw new Error('Image dimension limit is invalid');
  const result = await sharp(bytes, { failOn: 'error', limitInputPixels: options.maxPixels ?? 40_000_000 })
    .rotate()
    .resize({ width: maxDimension, height: maxDimension, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 95 })
    .toBuffer();
  const info = await inspectImage(result, { ...options, maxBytes: Math.max(options.maxBytes ?? 10 * 1024 * 1024, result.byteLength) });
  return { bytes: result, info, source, converted: source.format !== 'jpeg' || source.hasAlpha || source.orientation !== undefined || source.width !== info.width || source.height !== info.height };
}

export async function inspectMask(bytes: Uint8Array, expected: { width: number; height: number; maxBytes?: number }): Promise<{ width: number; height: number; whitePixels: number; blackPixels: number }> {
  checkBytes(bytes, expected.maxBytes ?? 10 * 1024 * 1024);
  if (![expected.width, expected.height].every((value) => Number.isSafeInteger(value) && value > 0) || expected.width * expected.height > 40_000_000) throw new Error('Mask dimensions are invalid');
  const image = sharp(bytes, { failOn: 'error', limitInputPixels: 40_000_000, animated: true });
  const metadata = await image.metadata();
  if (metadata.format !== 'png' || (metadata.pages ?? 1) !== 1) throw new Error('Mask must be a PNG image');
  if (metadata.width !== expected.width || metadata.height !== expected.height) throw new Error('Mask dimensions do not match the input');
  const { data, info } = await image.toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let whitePixels = 0;
  let blackPixels = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const [r, g, b, alpha] = data.subarray(i, i + 4);
    if (alpha !== 255 || r !== g || r !== b || (r !== 0 && r !== 255)) throw new Error('Mask must contain opaque black and white pixels');
    if (r === 255) whitePixels++; else blackPixels++;
  }
  if (!whitePixels) throw new Error('Mask contains no white region');
  return { width: expected.width, height: expected.height, whitePixels, blackPixels };
}
