import path from 'node:path';
import { stdout } from 'node:process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { generateOptimizedImages } from './lib/optimized-images.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const start = performance.now();
const result = await generateOptimizedImages({
  inputDirectory: path.join(repositoryRoot, 'public', 'uploads'),
  outputDirectory: path.join(repositoryRoot, 'public', 'generated', 'uploads'),
  // Native build cache: https://vercel.com/docs/deployments/troubleshoot-a-build#what-is-cached
  cacheDirectory: path.join(repositoryRoot, '.vercel', 'cache', 'optimized-images'),
});

stdout.write(`[images] Prepared ${result.derivatives} responsive WebP files from ${result.files} CMS images: encoded ${result.generated}, reused ${result.reused} in ${((performance.now() - start) / 1000).toFixed(2)}s.\n`);
