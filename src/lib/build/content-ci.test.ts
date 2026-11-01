import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { parseEntry, markdownIssues, htmlIssues } from '../content-api/validation';
import { parseCmsDocument } from '../../../scripts/lib/cms-document.mjs';
import { changedFiles } from '../../../scripts/ci-plan.mjs';

describe('content CI safety gate', () => {
  it('rejects executable Markdown, unsafe links and active HTML through the existing content contract', () => {
    for (const text of ['<script>alert(1)</script>', '[x](javascript:alert)', 'import X from "x";']) expect(markdownIssues(text).length).toBeGreaterThan(0);
    expect(htmlIssues('<img src="/uploads/a.png" alt="a" onerror="alert(1)">').length).toBeGreaterThan(0);
    expect(markdownIssues('## Safe heading\n\n![An original image](/uploads/original.png)')).toEqual([]);
  });
  const files = changedFiles(process.env.BASE_SHA, process.env.HEAD_SHA) ?? [];
  for (const file of files.filter(file => existsSync(file))) {
    if (/^src\/content\/(?:blog\/[^/]+\.md|landing-pages\/[^/]+\.json)$/.test(file)) {
      it(`validates the complete changed entry: ${file}`, () => {
        const record = parseCmsDocument(file, readFileSync(file, 'utf8'));
        const kind = file.startsWith('src/content/blog/') ? 'blog' : 'landing';
        // Preserve read-only legacy comparison fields; this check never updates a baseline.
        expect(() => parseEntry(kind, { data: record.data, body: record.body }, String(record.data.slug), record)).not.toThrow();
      });
    } else if (/^public\/uploads\/.+\.(?:png|jpe?g|webp|gif|avif)$/i.test(file)) {
      it(`decodes the original changed image without rewriting bytes: ${file}`, async () => {
        const image = sharp(readFileSync(file), { limitInputPixels: 100_000_000 });
        expect((await image.metadata()).format).toMatch(/^(png|jpeg|webp|gif|heif)$/);
        await expect(image.stats()).resolves.toHaveProperty('channels');
      });
    }
  }
});
