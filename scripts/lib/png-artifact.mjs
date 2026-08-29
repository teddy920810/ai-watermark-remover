/* global Buffer */

import sharp from 'sharp';

export async function inspectPngArtifact(bytes, options = {}) {
  const input = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const metadata = await sharp(input).metadata();
  if (metadata.format !== 'png' || !metadata.width || !metadata.height) {
    throw new Error('Result artifact is not a valid PNG image.');
  }

  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let hasTransparentPixel = false;
  let matchesExpectedOpaqueColor = true;
  const expectedColor = options.expectedOpaqueColor;

  for (let index = 0; index < data.length; index += info.channels) {
    const alpha = data[index + 3];
    if (alpha < 255) hasTransparentPixel = true;
    if (expectedColor && (
      alpha !== 255
      || data[index] !== expectedColor[0]
      || data[index + 1] !== expectedColor[1]
      || data[index + 2] !== expectedColor[2]
    )) matchesExpectedOpaqueColor = false;
  }

  if (options.requireTransparency && !hasTransparentPixel) {
    throw new Error('Result PNG does not contain transparent pixels.');
  }
  if (expectedColor && !matchesExpectedOpaqueColor) {
    throw new Error('Result PNG does not match the expected opaque background color.');
  }

  return {
    format: metadata.format,
    width: metadata.width,
    height: metadata.height,
    hasAlpha: metadata.hasAlpha,
    hasTransparentPixel,
    matchesExpectedOpaqueColor: expectedColor ? matchesExpectedOpaqueColor : undefined,
  };
}
