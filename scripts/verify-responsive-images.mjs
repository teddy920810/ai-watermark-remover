import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { cwd, stdout } from 'node:process';

const outputDirectory = resolve(cwd(), 'dist', 'client');
const htmlFiles = [];

function collectHtmlFiles(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) collectHtmlFiles(path);
    else if (entry.endsWith('.html')) htmlFiles.push(path);
  }
}

collectHtmlFiles(outputDirectory);

const failures = [];
const imagePattern = /<img\b[^>]*\bsrc="(\/uploads\/[a-z0-9/_-]+\.(?:jpe?g|png))"[^>]*>/gi;

for (const path of htmlFiles) {
  const html = readFileSync(path, 'utf8');
  for (const match of html.matchAll(imagePattern)) {
    const source = match[1];
    const imageIndex = match.index ?? 0;
    const pictureStart = html.lastIndexOf('<picture', imageIndex);
    const pictureEnd = html.lastIndexOf('</picture>', imageIndex);
    const picturePrefix = pictureStart > pictureEnd ? html.slice(pictureStart, imageIndex) : '';
    if (!picturePrefix.includes(`srcset="/generated${source}-`)) {
      failures.push(`${relative(outputDirectory, path)}: ${source}`);
    }
  }
}

if (failures.length > 0) {
  throw new Error(`CMS raster images are missing responsive WebP sources:\n${failures.join('\n')}`);
}

stdout.write(`[images] Verified responsive WebP markup in ${htmlFiles.length} HTML files.\n`);
