import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateOptimizedImages } from '../../../scripts/lib/optimized-images.mjs';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('optimized image generator', () => {
  async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'watermark-images-'));
    temporaryDirectories.push(root);
    const inputDirectory = join(root, 'uploads');
    const outputDirectory = join(root, 'generated');
    const cacheDirectory = join(root, 'cache');
    await mkdir(join(inputDirectory, 'guides'), { recursive: true });
    const input = join(inputDirectory, 'guides', 'example.png');
    await sharp({ create: { width: 8, height: 4, channels: 3, background: 'red' } }).png({ compressionLevel: 0 }).toFile(input);
    return { input, options: { inputDirectory, outputDirectory, cacheDirectory, widths: [4, 8] } };
  }

  async function snapshot(directory: string): Promise<Record<string, string>> {
    const files: Record<string, string> = {};
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        for (const [name, bytes] of Object.entries(await snapshot(join(directory, entry.name)))) files[`${entry.name}/${name}`] = bytes;
      } else files[entry.name] = (await readFile(join(directory, entry.name))).toString('base64');
    }
    return files;
  }

  it('reuses unchanged images and restores an empty output with byte-identical cold/warm results', async () => {
    const { options } = await fixture();
    expect(await generateOptimizedImages(options)).toMatchObject({ generated: 2, reused: 0 });
    const cold = await snapshot(options.outputDirectory);
    const encode = vi.spyOn(sharp.prototype, 'webp');
    expect(await generateOptimizedImages(options)).toMatchObject({ generated: 0, reused: 2 });
    await rm(options.outputDirectory, { recursive: true });
    expect(await generateOptimizedImages(options)).toMatchObject({ generated: 0, reused: 2 });
    expect(await snapshot(options.outputDirectory)).toEqual(cold);
    expect(encode).not.toHaveBeenCalled();
  });

  it('invalidates same-name replacements even when size and modification time match', async () => {
    const { input, options } = await fixture();
    await generateOptimizedImages(options);
    const before = await snapshot(options.outputDirectory);
    const originalStat = await stat(input);
    const replacement = await sharp({ create: { width: 8, height: 4, channels: 3, background: 'blue' } }).png({ compressionLevel: 0 }).toBuffer();
    expect(replacement.length).toBe(originalStat.size);
    await writeFile(input, replacement);
    await utimes(input, originalStat.atime, originalStat.mtime);
    expect(await generateOptimizedImages(options)).toMatchObject({ generated: 2, reused: 0 });
    expect(await snapshot(options.outputDirectory)).not.toEqual(before);
    const coldDirectory = join(options.outputDirectory, '..', 'fresh');
    await generateOptimizedImages({ ...options, outputDirectory: coldDirectory, cacheDirectory: undefined });
    expect(await snapshot(options.outputDirectory)).toEqual(await snapshot(coldDirectory));
  });

  it('encodes only added images and removes derivatives for deleted sources', async () => {
    const { input, options } = await fixture();
    await generateOptimizedImages(options);
    await writeFile(join(options.inputDirectory, 'new.png'), await readFile(input));
    // Identical source content can share the cache regardless of filename.
    expect(await generateOptimizedImages(options)).toMatchObject({ generated: 0, reused: 4 });
    await sharp({ create: { width: 8, height: 4, channels: 3, background: 'blue' } }).png().toFile(join(options.inputDirectory, 'new.png'));
    expect(await generateOptimizedImages(options)).toMatchObject({ generated: 2, reused: 2 });
    await rm(input);
    expect(await generateOptimizedImages(options)).toMatchObject({ files: 1, derivatives: 2, generated: 0, reused: 2 });
    expect(Object.keys(await snapshot(options.outputDirectory))).toEqual(['new.png-4.webp', 'new.png-8.webp']);
  });

  it('invalidates encoding parameters and drops obsolete widths', async () => {
    const { options } = await fixture();
    await generateOptimizedImages(options);
    const changed = { ...options, widths: [3], webpOptions: { quality: 60, alphaQuality: 100, effort: 4 } };
    expect(await generateOptimizedImages(changed)).toMatchObject({ generated: 1, reused: 0 });
    expect(Object.keys(await snapshot(options.outputDirectory))).toEqual(['guides/example.png-3.webp']);
    expect(await generateOptimizedImages(changed)).toMatchObject({ generated: 0, reused: 1 });
    const qualityChange = { ...changed, webpOptions: { ...changed.webpOptions, quality: 90 } };
    expect(await generateOptimizedImages(qualityChange)).toMatchObject({ generated: 1, reused: 0 });
    const fresh = join(options.outputDirectory, '..', 'fresh');
    await generateOptimizedImages({ ...qualityChange, cacheDirectory: undefined, outputDirectory: fresh });
    expect(await snapshot(options.outputDirectory)).toEqual(await snapshot(fresh));
  });

  it('regenerates missing or corrupt cache artifacts and ignores malformed manifests', async () => {
    const { options } = await fixture();
    await generateOptimizedImages(options);
    const expected = await snapshot(options.outputDirectory);
    const [key] = await readdir(options.cacheDirectory);
    const cache = join(options.cacheDirectory, key);
    await rm(join(cache, '4.webp'));
    expect(await generateOptimizedImages(options)).toMatchObject({ generated: 1, reused: 1 });
    await writeFile(join(cache, '8.webp'), 'corrupt');
    expect(await generateOptimizedImages(options)).toMatchObject({ generated: 1, reused: 1 });
    await writeFile(join(cache, 'manifest.json'), '{broken');
    expect(await generateOptimizedImages(options)).toMatchObject({ generated: 2, reused: 0 });
    expect(await snapshot(options.outputDirectory)).toEqual(expected);
  });

  it('removes stale derivatives even when all source images are deleted', async () => {
    const { input, options } = await fixture();
    await generateOptimizedImages(options);
    await rm(input);
    expect(await generateOptimizedImages(options)).toMatchObject({ files: 0, derivatives: 0 });
    expect(await snapshot(options.outputDirectory)).toEqual({});
  });

  it('invalidates the cache when the encoder version changes', async () => {
    const { options } = await fixture();
    await generateOptimizedImages(options);
    const previous = sharp.versions.webp;
    try {
      sharp.versions.webp = `${previous}-upgrade`;
      expect(await generateOptimizedImages(options)).toMatchObject({ generated: 2, reused: 0 });
    } finally { sharp.versions.webp = previous; }
  });

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
