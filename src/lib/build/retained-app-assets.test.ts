import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { retainAppAssets } from '../../../scripts/retain-app-assets.mjs';
import { classifyTargetChanges } from '../../../scripts/build-target.mjs';

const directories: string[] = [];
const origin = 'https://ai-watermark-remover-k6gm0letk-shiyaos-projects-b1e333f0.vercel.app';
const body = Buffer.from('export const oldWorkspace = true;');
const asset = { path: '/_app-assets/Workspace.old.js', sha256: createHash('sha256').update(body).digest('hex'), byteSize: body.length, contentType: 'application/javascript' };
function fixture() { const root = mkdtempSync(path.join(tmpdir(), 'retained-app-assets-')); directories.push(root); return root; }
const manifest = (assets = [asset], source = origin) => ({ version: 1, origin: source, assets });
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('previous public App asset retention', () => {
  it('copies only pinned static bytes into the current App output without request credentials', async () => {
    const directory = fixture();
    const fetcher = vi.fn(async () => new Response(body, { headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Content-Length': String(body.length), 'Set-Cookie': 'must-not-be-copied' } }));
    await retainAppAssets(directory, manifest(), fetcher);
    expect(readFileSync(path.join(directory, asset.path.slice(1)))).toEqual(body);
    expect(fetcher).toHaveBeenCalledWith(`${origin}${asset.path}`, expect.objectContaining({ redirect: 'error', credentials: 'omit', headers: { Accept: 'application/javascript' } }));
    expect(fetcher.mock.calls).toHaveLength(1);
  });
  it('preserves newly generated assets at the same path and never fetches their old version', async () => {
    const directory = fixture(); const file = path.join(directory, asset.path.slice(1)); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, 'current build');
    const fetcher = vi.fn(); await retainAppAssets(directory, manifest(), fetcher);
    expect(readFileSync(file, 'utf8')).toBe('current build'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('validates the entire allowlist before any fetch or write', async () => {
    for (const unsafe of ['/api/v1/jobs.js', '/_app-assets/../private.js', '/_app-assets/%2e%2e/private.js', '/_app-assets/file.js?token=secret', '/_app-assets/index.html', '//outside/file.js', '/_app-assets/.env.js']) {
      const directory = fixture(); const fetcher = vi.fn();
      await expect(retainAppAssets(directory, manifest([asset, { ...asset, path: unsafe }]), fetcher)).rejects.toThrow();
      expect(fetcher).not.toHaveBeenCalled(); expect(existsSync(path.join(directory, '_app-assets'))).toBe(false);
    }
    for (const unsafeOrigin of ['http://example.com', 'https://www.watermarkgemini.com', 'https://ai-watermark-remover-git-main-shiyaos-projects-b1e333f0.vercel.app', `${origin}/path`, origin.replace('https://', 'https://user:secret@')]) {
      const fetcher = vi.fn(); await expect(retainAppAssets(fixture(), manifest([asset], unsafeOrigin), fetcher)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
    }
  });
  it('rejects unexpected bytes, MIME types, redirects, declared size and truncated responses without writing the file', async () => {
    const responses = [
      () => new Response(Buffer.alloc(body.length, 120), { headers: { 'Content-Type': asset.contentType } }),
      () => new Response(body, { headers: { 'Content-Type': 'text/html' } }),
      () => new Response(null, { status: 302, headers: { Location: 'https://outside.test/' } }),
      () => new Response(body, { headers: { 'Content-Type': asset.contentType, 'Content-Length': String(body.length + 1) } }),
      () => new Response(body.subarray(1), { headers: { 'Content-Type': asset.contentType } }),
      () => new Response(Buffer.alloc(body.length + 1), { headers: { 'Content-Type': asset.contentType } }),
    ];
    for (const response of responses) {
      const directory = fixture(); await expect(retainAppAssets(directory, manifest(), async () => response())).rejects.toThrow();
      expect(existsSync(path.join(directory, asset.path.slice(1)))).toBe(false);
    }
  });
  it('rejects duplicate paths, unbounded manifests and MIME extensions that do not match', async () => {
    for (const value of [manifest([asset, asset]), manifest([{ ...asset, byteSize: 6_000_000 }]), manifest([{ ...asset, contentType: 'text/html' }]), { ...manifest(), version: 2 }]) {
      const fetcher = vi.fn(); await expect(retainAppAssets(fixture(), value, fetcher)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
    }
  });
  it('keeps retention App-only and acceptance tooling outside both deployment targets', () => {
    expect(classifyTargetChanges(['scripts/retain-app-assets.mjs', 'apps/app/retained-assets.json'])).toEqual(['app']);
    expect(classifyTargetChanges(['scripts/processing-acceptance.mjs', 'scripts/lib/acceptance-budget.mjs'])).toEqual([]);
  });
});
