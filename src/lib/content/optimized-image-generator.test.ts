import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { generateOptimizedImages } from '../../../scripts/lib/optimized-images.mjs';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('optimized image generator', () => {
  it('creates responsive WebP derivatives for nested PNG/JPEG files and skips other formats', async () => {
    const root = await mkdtemp(join(tmpdir(), 'watermark-images-'));
    temporaryDirectories.push(root);
    const inputDirectory = join(root, 'uploads');
    const outputDirectory = join(root, 'generated');
    await mkdir(join(inputDirectory, 'guides'), { recursive: true });
    await sharp({
      create: { width: 8, height: 4, channels: 4, background: { r: 20, g: 80, b: 220, alpha: 1 } },
    }).png().toFile(join(inputDirectory, 'guides', 'example.png'));
    await sharp({
      create: { width: 6, height: 3, channels: 3, background: { r: 20, g: 180, b: 120 } },
    }).jpeg().toFile(join(inputDirectory, 'photo.jpg'));
    await sharp({
      create: { width: 8, height: 4, channels: 4, background: { r: 20, g: 80, b: 220, alpha: 1 } },
    }).webp().toFile(join(inputDirectory, 'existing.webp'));

    const result = await generateOptimizedImages({
      inputDirectory,
      outputDirectory,
      widths: [4, 8],
    });

    expect(result.files).toBe(2);
    expect(result.derivatives).toBe(4);
    const pngOutput = join(outputDirectory, 'guides', 'example.png-4.webp');
    expect((await sharp(await readFile(pngOutput)).metadata()).format).toBe('webp');
    await expect(readFile(join(outputDirectory, 'existing.webp-4.webp'))).rejects.toThrow();
  });
});
