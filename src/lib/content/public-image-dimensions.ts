import { readFileSync } from 'node:fs';

export interface ImageDimensions {
  width: number;
  height: number;
}

function readPng(buffer: Buffer): ImageDimensions | undefined {
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') return undefined;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function readWebp(buffer: Buffer): ImageDimensions | undefined {
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    return undefined;
  }

  const kind = buffer.toString('ascii', 12, 16);
  if (kind === 'VP8X') {
    return { width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 };
  }
  if (kind === 'VP8 ') {
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  if (kind === 'VP8L') {
    const first = buffer[21] ?? 0;
    const second = buffer[22] ?? 0;
    const third = buffer[23] ?? 0;
    const fourth = buffer[24] ?? 0;
    return {
      width: 1 + first + ((second & 0x3f) << 8),
      height: 1 + (second >> 6) + (third << 2) + ((fourth & 0x0f) << 10),
    };
  }
  return undefined;
}

function readJpeg(buffer: Buffer): ImageDimensions | undefined {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) return undefined;
    const marker = buffer[offset + 1] ?? 0;
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return undefined;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb)) {
      return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
    }
    offset += length + 2;
  }
  return undefined;
}

type ReadImage = (path: URL) => Buffer;

export function resolvePublicImageDimensions(
  src: string,
  readImage: ReadImage = (path) => readFileSync(path),
): ImageDimensions | undefined {
  if (!/^\/uploads\/[a-z0-9/_-]+\.(?:jpe?g|png|webp)$/i.test(src) || src.includes('..')) return undefined;
  try {
    const buffer = readImage(new URL(`../../../public/${src.slice(1)}`, import.meta.url));
    return readPng(buffer) ?? readWebp(buffer) ?? readJpeg(buffer);
  } catch {
    return undefined;
  }
}
