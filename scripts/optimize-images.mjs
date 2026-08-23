import path from 'node:path';
import { stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { generateOptimizedImages } from './lib/optimized-images.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = await generateOptimizedImages({
  inputDirectory: path.join(repositoryRoot, 'public', 'uploads'),
  outputDirectory: path.join(repositoryRoot, 'public', 'generated', 'uploads'),
});

stdout.write(`[images] Generated ${result.derivatives} responsive WebP files from ${result.files} CMS images.\n`);
