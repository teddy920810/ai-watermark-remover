import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const defaultWidths = [480, 768, 1200];

async function rasterFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await rasterFiles(entryPath));
    else if (entry.isFile() && /\.(?:jpe?g|png)$/i.test(entry.name)) files.push(entryPath);
  }
  return files;
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

export async function generateOptimizedImages({
  inputDirectory,
  outputDirectory,
  widths = defaultWidths,
}) {
  const inputs = await rasterFiles(inputDirectory);
  let derivatives = 0;

  for (const input of inputs) {
    const metadata = await sharp(input).metadata();
    if (!metadata.width) continue;
    const relativePath = path.relative(inputDirectory, input);
    const outputParent = path.join(outputDirectory, path.dirname(relativePath));
    await mkdir(outputParent, { recursive: true });
    for (const width of selectedWidths(metadata.width, widths)) {
      const output = path.join(outputParent, `${path.basename(relativePath)}-${width}.webp`);
      await sharp(input)
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 82, alphaQuality: 100, effort: 4 })
        .toFile(output);
      derivatives += 1;
    }
  }

  return { files: inputs.length, derivatives };
}
