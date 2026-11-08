import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { URL } from 'node:url';
import { Buffer } from 'node:buffer';
import console from 'node:console';
const { fetch } = globalThis;

// Explicit maintenance command only; normal installs/builds never fetch upstream code.
const commit = '4fb1433649e01e626b7cae3c7ae02721e0ab0e65'; // v1.0.46
const base = `https://raw.githubusercontent.com/GargantuaX/gemini-watermark-remover/${commit}/`;
const directory = fileURLToPath(new URL('../src/vendor/gemini/', import.meta.url));
const sources = {};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const result = await build({
  stdin: { contents: "export { removeWatermarkFromImageDataSync } from './src/sdk/image-data.js'; export { inspectGeminiVideoFile, removeGeminiVideoWatermark } from './src/video/videoExport.js'; export { getEmbeddedAlphaMap } from './src/core/embeddedAlphaMaps.js'; export { getVideoAlphaMap } from './src/video/videoWatermarkDetector.js';", resolveDir: '/', sourcefile: 'entry.js' },
  bundle: true, format: 'esm', target: 'es2022', minify: true, write: false, legalComments: 'inline', external: ['mediabunny'],
  plugins: [{ name: 'pinned-upstream', setup(builder) {
    builder.onResolve({ filter: /^\./ }, args => ({ path: path.posix.normalize(path.posix.join(args.importer ? path.posix.dirname(args.importer) : '', args.path)), namespace: 'upstream' }));
    builder.onLoad({ filter: /.*/, namespace: 'upstream' }, async args => {
      if (!args.path.startsWith('src/') || args.path.includes('..')) throw new Error('Unexpected upstream import');
      const response = await fetch(new URL(args.path, base));
      if (!response.ok) throw new Error(`Upstream file unavailable: ${args.path}`);
      const contents = await response.text(); sources[args.path] = hash(contents);
      return { contents, loader: 'js' };
    });
  } }],
});
const license = await fetch(new URL('LICENSE', base)).then(response => { if (!response.ok) throw new Error('License unavailable'); return response.text(); });
const output = `/*! Gemini Watermark Remover v1.0.46; MIT; Copyright 2025 Jad, 2024 AllenK (Kwyshell). See LICENSE and provenance.json. */\n${result.outputFiles[0].text}`;
await mkdir(directory, { recursive: true });
await writeFile(path.join(directory, 'engine.js'), output);
await writeFile(path.join(directory, 'LICENSE'), license);
await writeFile(path.join(directory, 'MEDIABUNNY-LICENSE'), await readFile(new URL('../node_modules/mediabunny/LICENSE', import.meta.url)));
await writeFile(path.join(directory, 'provenance.json'), JSON.stringify({ repository: 'https://github.com/GargantuaX/gemini-watermark-remover', version: '1.0.46', commit, license: 'MIT', outputSha256: hash(output), sources: Object.fromEntries(Object.entries(sources).sort()) }, null, 2) + '\n');
console.log(`Vendored ${Object.keys(sources).length} pinned modules (${Buffer.byteLength(output)} bytes).`);
