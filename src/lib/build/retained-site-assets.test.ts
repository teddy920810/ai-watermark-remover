import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import * as retention from '../../../scripts/retain-app-assets.mjs';
import { classifyTargetChanges } from '../../../scripts/build-target.mjs';

const body = Buffer.from('export const previousPublicSite = true;');
const asset = { path: '/_site-assets/previous.js', sha256: createHash('sha256').update(body).digest('hex'), byteSize: body.length, contentType: 'application/javascript' };
const manifest = { version: 1, origin: 'https://ai-watermark-site.vercel.app', assets: [asset] };
describe('prior Site asset preservation', () => {
  it('pins the currently published Site graph without changing its source bytes', () => {
    const value = JSON.parse(readFileSync(new URL('../../../apps/site/retained-assets.json', import.meta.url), 'utf8'));
    expect(value.origin).toBe(manifest.origin);
    expect(value.assets).toHaveLength(14);
    expect(value.assets).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/_site-assets/AuthControls.B9oav8Sw.js', sha256: 'c409759a0cb830d5a865fb9fbb9d49469a10f79aad00463ebb8540327b6ff646' }),
      expect.objectContaining({ path: '/_site-assets/MediaLauncher.DdIUGJ0w.js', sha256: '5f1d49566aa772de961c270740867a37c0f57c8386e451466c4850c9c5aac6ff' }),
      expect.objectContaining({ path: '/_site-assets/index.c43oQ-O6.css', sha256: 'c9aa53d86b5430716b365cd6afb7c91c30d6f6a88153a1ecbd9d1482a1195db0' }),
      expect.objectContaining({ path: '/_site-assets/MediaLauncher.BwvaaFyJ.js', sha256: 'c849e012c82ce72e2513ce31b87ca3f8a7f1e39f208628acead5533290464cb8', byteSize: 8763, contentType: 'application/javascript' }),
    ]));
  });
  it('copies only pinned Site bytes and rejects a different origin or namespace before fetching', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'retained-site-assets-'));
    const fetcher = vi.fn(async () => new Response(body, { headers: { 'Content-Type': asset.contentType } }));
    try {
      await retention.retainSiteAssets(directory, manifest, fetcher);
      expect(readFileSync(path.join(directory, '_site-assets/previous.js'))).toEqual(body);
      expect(fetcher).toHaveBeenCalledWith(`${manifest.origin}${asset.path}`, expect.objectContaining({ redirect: 'error', credentials: 'omit' }));
      fetcher.mockClear();
      for (const invalid of [{ ...manifest, origin: 'https://www.watermarkgemini.com' }, { ...manifest, assets: [{ ...asset, path: '/_app-assets/previous.js' }] }, { ...manifest, assets: [{ ...asset, path: '/_site-assets/../private.js' }] }]) await expect(retention.retainSiteAssets(directory, invalid, fetcher)).rejects.toThrow();
      expect(fetcher).not.toHaveBeenCalled();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('selects both consumers of shared retention and only Site for its manifest', () => {
    expect(classifyTargetChanges(['scripts/retain-app-assets.mjs'])).toEqual(['site', 'app']);
    expect(classifyTargetChanges(['apps/site/retained-assets.json'])).toEqual(['site']);
  });
});
