import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { createDraftExample } from '../../../docs/examples/content-api/draft.mjs';
import { parseEntry } from './validation';

describe('executable operator examples', () => {
  it('retains all supported fields in both Blog modes and every landing module', async () => {
    const landing = JSON.parse(await readFile('docs/examples/content-api/landing.json', 'utf8'));
    expect(parseEntry('landing', landing, landing.data.slug).data).toMatchObject(landing.data);
    for (const field of ['heroSamples', 'heroActions', 'uploader', 'process', 'features', 'scope', 'relatedTools', 'guides', 'cta', 'faq']) expect(landing.data[field], field).toBeDefined();
    for (const name of ['blog', 'blog-html']) {
      const document = JSON.parse(await readFile(`docs/examples/content-api/${name}.json`, 'utf8'));
      expect(parseEntry('blog', document, document.data.slug).data).toMatchObject(document.data);
    }
  });
  it('uploads two independent files, uses complete returned paths, and resumes a lost upload response with the original key', async () => {
    const root = await mkdtemp(join(tmpdir(), 'operator-example-'));
    try {
      const before = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#3388aa' } }).png().toBuffer();
      const after = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#4488aa' } }).png().toBuffer();
      await writeFile(join(root, 'before.png'), before); await writeFile(join(root, 'after.png'), after);
      await writeFile(join(root, 'token.txt'), 'test-only-token-012345678901234567890');
      await writeFile(join(root, 'custom.json'), await readFile('docs/examples/content-api/landing.json'));
      const replay = new Map<string, object>(); const assetKeys: string[] = []; let lost = false; let saves = 0;
      const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
        const key = new Headers(init?.headers).get('idempotency-key')!;
        const pathname = new URL(String(url)).pathname; const payload = JSON.parse(String(init?.body));
        const result = replay.get(key) ?? (() => {
          if (pathname.endsWith('/validate')) return { publishable: true, issues: [] };
          if (pathname.includes('/entries/')) { saves++; expect(payload.data.draft).toBe(true); expect(payload.data.heroSamples[0].afterImage).toMatch(/^\/uploads\/content-api\/a{24}\/editorial-after-/); expect(() => parseEntry('landing', payload, payload.data.slug)).not.toThrow(); }
          const change: Record<string, unknown> = { id: 'a'.repeat(24), revision: String(replay.size + 1).padStart(40, '0') };
          if (pathname.endsWith('/assets')) {
            assetKeys.push(key); const bytes = Buffer.from(payload.base64, 'base64'); const digest = createHash('sha256').update(bytes).digest('hex');
            change.asset = { path: `/uploads/content-api/${'a'.repeat(24)}/${payload.name.slice(0, -4)}-${digest.slice(0, 16)}.png`, sha256: digest, width: 40, height: 30, bytes: bytes.length, mime: 'image/png' };
          }
          return change;
        })();
        replay.set(key, result);
        if (pathname.endsWith('/assets') && !lost) { lost = true; throw new Error('simulated lost response'); }
        return new Response(JSON.stringify(result));
      }) as typeof fetch;
      const options = { documentFile: join(root, 'custom.json'), tokenFile: join(root, 'token.txt'), beforeFile: join(root, 'before.png'), afterFile: join(root, 'after.png'), alignedPair: true, output: join(root, 'recovery.json'), fetcher };
      await expect(createDraftExample(options)).rejects.toThrow('simulated lost response');
      const result = await createDraftExample(options);
      expect(result.publishable).toBe(true); expect(assetKeys).toHaveLength(2); expect(saves).toBe(1);
      const journal = await readFile(options.output, 'utf8'); expect(journal).not.toContain('test-only-token'); expect(journal).not.toContain(before.toString('base64'));
      const saved = JSON.parse(journal); expect(saved.last.assets.before.path).not.toBe(saved.last.assets.after.path); expect(saved.last.document.data.features.items[0].afterImage).toBe(saved.last.assets.after.path);
      await createDraftExample(options); expect(saves).toBe(1);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
