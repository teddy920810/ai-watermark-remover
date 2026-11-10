import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';
import sharp from 'sharp';

const defaultWidths = [480, 768, 1200];
const defaultWebpOptions = { quality: 82, alphaQuality: 100, effort: 4 };
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
// Any pipeline edit or encoder/runtime change invalidates prior results.
const encoderIdentity = {
  pipeline: digest(await readFile(new URL(import.meta.url))),
  versions: sharp.versions,
  platform: process.platform,
  arch: process.arch,
};

async function matchingFiles(directory, pattern) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await matchingFiles(entryPath, pattern));
    else if (entry.isFile() && pattern.test(entry.name)) files.push(entryPath);
  }
  return files;
}

async function readManifest(directory) {
  try {
    const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
    return manifest && typeof manifest === 'object' ? manifest : {};
  } catch { return {}; }
}

async function cachedImage(directory, width, expectedDigest) {
  if (!directory || typeof expectedDigest !== 'string') return;
  try {
    const bytes = await readFile(path.join(directory, `${width}.webp`));
    if (digest(bytes) === expectedDigest) return bytes;
  } catch { /* A missing or damaged cache is a miss, never a stale result. */ }
}

function selectedWidths(originalWidth, widths) {
  const sortedWidths = [...new Set(widths)]
    .filter((width) => Number.isSafeInteger(width) && width > 0)
    .sort((left, right) => left - right);
  const maximumWidth = sortedWidths.at(-1);
  if (!maximumWidth) return [];
  return [...new Set([
    ...sortedWidths.filter((width) => width < originalWidth),
    Math.min(originalWidth, maximumWidth),
  ])].sort((left, right) => left - right);
}

/** @param {{ inputDirectory: string, outputDirectory: string, cacheDirectory?: string, widths?: number[], webpOptions?: import('sharp').WebpOptions }} options */
export async function generateOptimizedImages({
  inputDirectory,
  outputDirectory,
  cacheDirectory,
  widths = defaultWidths,
  webpOptions = defaultWebpOptions,
}) {
  const inputs = await matchingFiles(inputDirectory, /\.(?:jpe?g|png)$/i);
  let derivatives = 0;
  let generated = 0;
  let reused = 0;
  const expectedOutputs = new Set();
  await mkdir(outputDirectory, { recursive: true });

  for (const input of inputs) {
    // Read once so the cache key and encoder see exactly the same source bytes.
    const source = await readFile(input);
    const metadata = await sharp(source).metadata();
    if (!metadata.width) continue;
    const outputWidths = selectedWidths(metadata.width, widths);
    const resizeOptions = { withoutEnlargement: true };
    const key = digest(JSON.stringify({ source: digest(source), widths: outputWidths, resizeOptions, webpOptions, encoderIdentity }));
    const cache = cacheDirectory ? path.join(cacheDirectory, key) : undefined;
    const manifest = cache ? await readManifest(cache) : {};
    const nextManifest = {};
    const relativePath = path.relative(inputDirectory, input);
    const outputParent = path.join(outputDirectory, path.dirname(relativePath));
    await mkdir(outputParent, { recursive: true });
    for (const width of outputWidths) {
      const output = path.join(outputParent, `${path.basename(relativePath)}-${width}.webp`);
      expectedOutputs.add(output);
      let bytes = await cachedImage(cache, width, manifest[width]);
      if (bytes) reused += 1;
      else {
        bytes = await sharp(source).resize({ width, ...resizeOptions }).webp(webpOptions).toBuffer();
        generated += 1;
        if (cache) {
          await mkdir(cache, { recursive: true });
          await writeFile(path.join(cache, `${width}.webp`), bytes);
        }
      }
      nextManifest[width] = digest(bytes);
      // Always materialize this build's output, including missing/damaged public files.
      await writeFile(output, bytes);
      derivatives += 1;
    }
    if (cache && outputWidths.length) await writeFile(path.join(cache, 'manifest.json'), JSON.stringify(nextManifest));
  }

  // Only remove obsolete generated derivatives, never source images or cache entries.
  for (const output of await matchingFiles(outputDirectory, /\.(?:jpe?g|png)-\d+\.webp$/i)) {
    if (!expectedOutputs.has(output)) await unlink(output);
  }
  return { files: inputs.length, derivatives, generated, reused };
}
