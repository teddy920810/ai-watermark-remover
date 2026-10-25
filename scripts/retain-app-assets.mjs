/* global AbortSignal, fetch */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, realpathSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

const mimeTypes = { '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2' };

function validateManifest(manifest) {
  if (manifest?.version !== 1 || typeof manifest.origin !== 'string'
    || !/^https:\/\/ai-watermark-remover-[a-z0-9]{9}-shiyaos-projects-b1e333f0\.vercel\.app$/.test(manifest.origin)
    || !Array.isArray(manifest.assets) || manifest.assets.length < 1 || manifest.assets.length > 32) throw new Error('Invalid retained App asset manifest');
  const paths = new Set(); let bytes = 0;
  for (const asset of manifest.assets) {
    if (typeof asset.path !== 'string' || !/^\/_app-assets\/(?:[A-Za-z0-9_][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(asset.path)
      || paths.has(asset.path) || !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.byteSize) || asset.byteSize < 1 || asset.byteSize > 5_000_000
      || mimeTypes[path.extname(asset.path)] !== asset.contentType) throw new Error('Invalid retained App asset entry');
    paths.add(asset.path); bytes += asset.byteSize;
  }
  if (bytes > 20_000_000) throw new Error('Retained App assets exceed the build limit');
}

function assertWithin(root, destination) {
  let existing = destination;
  while (!existsSync(existing)) existing = path.dirname(existing);
  const relative = path.relative(root, realpathSync(existing));
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Retained App assets must remain inside the static output');
}

/** Copy reviewed public files into Build Output static, never routes or functions.
 * https://vercel.com/docs/build-output-api/primitives#static-files
 */
export async function retainAppAssets(staticDirectory, manifest, fetcher = fetch) {
  validateManifest(manifest);
  const root = realpathSync(staticDirectory); let retained = 0; let kept = 0;
  for (const asset of manifest.assets) {
    const destination = path.join(root, asset.path.slice(1)); assertWithin(root, destination);
    if (existsSync(destination)) {
      if (!lstatSync(destination).isFile()) throw new Error('Existing App asset must be a regular file');
      kept += 1; continue;
    }
    const requested = `${manifest.origin}${asset.path}`;
    const response = await fetcher(requested, { redirect: 'error', credentials: 'omit', headers: { Accept: asset.contentType }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok || response.redirected || response.url && response.url !== requested || !response.body) throw new Error('Retained App asset download failed');
    if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== asset.contentType) throw new Error('Retained App asset type differs');
    const declared = response.headers.get('content-length');
    if (declared !== null && Number(declared) !== asset.byteSize) throw new Error('Retained App asset declared size differs');
    const reader = response.body.getReader(); const chunks = []; let length = 0;
    try {
      for (;;) {
        const chunk = await reader.read(); if (chunk.done) break;
        length += chunk.value.byteLength; if (length > asset.byteSize) throw new Error('Retained App asset exceeds its pinned size');
        chunks.push(chunk.value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = Buffer.concat(chunks);
    if (length !== asset.byteSize || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error('Retained App asset bytes differ');
    mkdirSync(path.dirname(destination), { recursive: true }); assertWithin(root, destination);
    writeFileSync(destination, bytes, { flag: 'wx' }); retained += 1;
  }
  return { retained, kept };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  await retainAppAssets(path.join(root, '.vercel/output/static'), JSON.parse(readFileSync(path.join(root, 'apps/app/retained-assets.json'), 'utf8')));
}
