import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
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
  it('retains the two current production stylesheets replaced by the Header update', () => {
    const value = JSON.parse(readFileSync(new URL('../../../apps/app/retained-assets.json', import.meta.url), 'utf8'));
    expect(value.assets).toEqual(expect.arrayContaining([
      { path: '/_app-assets/AppWorkspaceLayout.Ch2LtI16.css', sha256: '10ed2616736f643dfc1597456fa72a2595a80199326d36aaae2318847d68e3e2', byteSize: 41902, contentType: 'text/css' },
      { path: '/_app-assets/payments.CRMEhp0R.css', sha256: '23ead3fa3948bd7be6b1fe9d6401d2cc94b0253bf91dc80420ca66940de112ad', byteSize: 29844, contentType: 'text/css' },
    ]));
  });
  it('retains the production checkout entry used before payment recovery changes', () => {
    const value = JSON.parse(readFileSync(new URL('../../../apps/app/retained-assets.json', import.meta.url), 'utf8'));
    expect(value.assets).toEqual(expect.arrayContaining([{ path: '/_app-assets/CreditCheckout.DF4Rby08.js', sha256: 'df8f60e5a4b3828b113bbb89b0228d39e2db74301aabf0b4586a5922c11891cd', byteSize: 15467, contentType: 'application/javascript' }]));
  });
  it('pins the current production workspace and all prior public assets on one immutable origin', () => {
    // Production 988656d carries every earlier generation. Preserve those pins
    // and its current checkout entry when publishing payment recovery changes.
    const value = JSON.parse(readFileSync(new URL('../../../apps/app/retained-assets.json', import.meta.url), 'utf8'));
    const expected = [
      { path: '/_app-assets/_kind_.VGEm7Omq.css', sha256: '0d9113dca4fa109508d538c20b4d58e540c86ae8c3a0d0681886a7225714bc92', byteSize: 74247, contentType: 'text/css' },
      { path: '/_app-assets/client.BJQPcj77.js', sha256: '5eaf28c8b13d01d5bb092c5260ec3c903906f07afd3d530b3c0c136f45580152', byteSize: 183969, contentType: 'application/javascript' },
      { path: '/_app-assets/public/uploads/background-remover-transparency-grid.png', sha256: 'a98023de0ce42177fd5cccb9a4fee30b5ec2424ee11e9cfae85bfb99930c5154', byteSize: 730090, contentType: 'image/png' },
      { path: '/_app-assets/public/uploads/watermarkgemini-logo.svg', sha256: '2fc67afeb0c4d99530a52d99ef8267d414b308a5e1a499fff734433472296926', byteSize: 1847, contentType: 'image/svg+xml' },
      { path: '/_app-assets/react.DSfmxFZS.js', sha256: 'adf1cf3c94a3015ed2afb1e9cc7ab4a7de1c13fd47d58ceebb5a685c21aacb19', byteSize: 7565, contentType: 'application/javascript' },
      { path: '/_app-assets/WatermarkWorkspace.BuEjo2iM.js', sha256: '37b9e5a287a734f1fbbf6a31f27efde5f99a87f96af715b8f8ab4e5df66abf1b', byteSize: 75720, contentType: 'application/javascript' },
      { path: '/_app-assets/_kind_.DeRaFZ08.css', sha256: '51965ec9d651fa3bbe68d530c240f5db788c4ccca13060c10024fa8d648b4b29', byteSize: 75296, contentType: 'text/css' },
      { path: '/_app-assets/WatermarkWorkspace.USrjb05O.js', sha256: 'c4aed2901066aa578e02001e5b85c36126067c0b2a404c7e074ab34609bcd2b7', byteSize: 77053, contentType: 'application/javascript' },
      { path: '/_app-assets/_kind_.DaZvEtyH.css', sha256: 'cb97c2a4b0dbba872435fd6cac268c386b89189b8ea39eff15012c86535fb2c3', byteSize: 77866, contentType: 'text/css' },
      { path: '/_app-assets/_kind_.D_vaBh4v.css', sha256: 'c6e0b25040635a17b9047f83e9bebe015b32a9a69479295bac5d37ab06c857d9', byteSize: 19407, contentType: 'text/css' },
      { path: '/_app-assets/arrow-right.DGLZUg4l.js', sha256: '9406cfff123e28ab6ad9180c0f5864e83ee16b3a8fa1e4c65cf1f068eed6e720', byteSize: 160, contentType: 'application/javascript' },
      { path: '/_app-assets/AuthControls.BYaZ8k8p.js', sha256: '92dd856697006a10d91dbfe4245b37af8d6c65e5d9ca0fbb42ab38afa4fa2a24', byteSize: 4311, contentType: 'application/javascript' },
      { path: '/_app-assets/CreditCheckout.C5vclqM6.js', sha256: '199620e3b0b9cf6345cc711fc382a060a96f7e8193aeb8a8191a9ec409b205e5', byteSize: 18874, contentType: 'application/javascript' },
      { path: '/_app-assets/credits.Cs3H74rl.css', sha256: '7ade13130d6ae7b90558a77c7d0699f78120c504158bec24975fbf961a591418', byteSize: 8839, contentType: 'text/css' },
      { path: '/_app-assets/global.DNxveWwK.css', sha256: '4f8397574906e6f99fb989c8afe8c8123a363032aadc27269fd6f44be66d5f68', byteSize: 58490, contentType: 'text/css' },
      { path: '/_app-assets/jsx-runtime.oWLvl7P2.js', sha256: 'aa927142f4c972eede1b3aee54e642f4231d91e839be48e951f4bc8d354bc05b', byteSize: 32785, contentType: 'application/javascript' },
      { path: '/_app-assets/user-round.Dhooj_tf.js', sha256: '1d29354e053ae22e5cd0eb6988150928c335935841dd2b8934f3834851b596f5', byteSize: 177, contentType: 'application/javascript' },
      { path: '/_app-assets/WatermarkWorkspace.BcRuoLVk.js', sha256: '25a1f60411cccfaa0a67d956f78c88cc61000551fbf4a3d05b06499a973680bf', byteSize: 48274, contentType: 'application/javascript' },
      { path: '/_app-assets/WatermarkWorkspace.Cs3H74rl.css', sha256: '7ade13130d6ae7b90558a77c7d0699f78120c504158bec24975fbf961a591418', byteSize: 8839, contentType: 'text/css' },
      { path: '/_app-assets/_kind_.1KZ3MJ3A.css', sha256: '100e4958d1504397641a7b7a58f0fcd4a8d9424c74947fe3169b83feb83d1921', byteSize: 77896, contentType: 'text/css' },
      { path: '/_app-assets/credits.BD2977eY.css', sha256: '907ec11d70a4c5b6861f8e221ed5a0078411ec2b184fa11a396a08db5245e6c1', byteSize: 67328, contentType: 'text/css' },
      { path: '/_app-assets/_kind_.D2i4fH02.css', sha256: '924fd1da6278031a6af7a7b7bb556f12ea39e36bb04c5d1befd95ce85a872001', byteSize: 77980, contentType: 'text/css' },
      { path: '/_app-assets/credits.C1ObQpkI.css', sha256: '85ffff39b0d08a7a40f24ff5a649eb041c99f9416261dfb47574028979d68120', byteSize: 67412, contentType: 'text/css' },
      { path: '/_app-assets/CreditCheckout.CQMqwqrS.js', sha256: '0b3ae904a69f1b238a63a577677dc6defa40604f4adab58d6037d511f3dac74f', byteSize: 19125, contentType: 'application/javascript' },
      { path: '/_app-assets/AppWorkspace.CYaIy_GU.js', sha256: '67d06b741f2be5ab650f61714910f8345e548979e8e3419265477aaedc8d4595', byteSize: 4784, contentType: 'application/javascript' },
      { path: '/_app-assets/WatermarkWorkspace.BmkIsLiM.js', sha256: '6aec322f775f07139a5e827edb88d3f3bf64b81b0f8a9e4406e11e8fcdbf1f07', byteSize: 60347, contentType: 'application/javascript' },
    ];
    expect(value.version).toBe(1);
    expect(value.origin).toBe('https://ai-watermark-remover-itgzugxj1-shiyaos-projects-b1e333f0.vercel.app');
    expect(value.assets).toEqual(expect.arrayContaining(expected));
    expect(value.assets.length).toBeLessThanOrEqual(32);
    expect(new Set(value.assets.map((entry: { path: string }) => entry.path)).size).toBe(value.assets.length);
    expect(value.assets.reduce((sum: number, entry: { byteSize: number }) => sum + entry.byteSize, 0)).toBeLessThanOrEqual(20_000_000);
  });

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
  it('retains the decoded gzip body when Node fetch preserves its compressed Content-Length header', async () => {
    const directory = fixture(); const wireBytes = gzipSync(body);
    expect(wireBytes.length).not.toBe(asset.byteSize);
    // Node fetch exposes decoded bytes while retaining upstream encoding headers.
    const fetcher = async () => new Response(body, { headers: { 'Content-Type': asset.contentType, 'Content-Encoding': 'gzip', 'Content-Length': String(wireBytes.length) } });
    await expect(retainAppAssets(directory, manifest(), fetcher)).resolves.toEqual({ retained: 1, kept: 0 });
    expect(readFileSync(path.join(directory, asset.path.slice(1)))).toEqual(body);
  });
  it('still validates decoded gzip size and hash instead of trusting compressed response headers', async () => {
    for (const decoded of [body.subarray(1), Buffer.alloc(body.length + 1), Buffer.alloc(body.length, 120)]) {
      const directory = fixture();
      const fetcher = async () => new Response(decoded, { headers: { 'Content-Type': asset.contentType, 'Content-Encoding': 'gzip', 'Content-Length': String(gzipSync(decoded).length) } });
      await expect(retainAppAssets(directory, manifest(), fetcher)).rejects.toThrow(/exceeds its pinned size|bytes differ/);
      expect(existsSync(path.join(directory, asset.path.slice(1)))).toBe(false);
    }
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
  it('selects both static-retention consumers and leaves acceptance tooling outside deployment targets', () => {
    expect(classifyTargetChanges(['scripts/retain-app-assets.mjs'])).toEqual(['site', 'app']);
    expect(classifyTargetChanges(['apps/app/retained-assets.json'])).toEqual(['app']);
    expect(classifyTargetChanges(['scripts/processing-acceptance.mjs', 'scripts/lib/acceptance-budget.mjs'])).toEqual([]);
  });
});
