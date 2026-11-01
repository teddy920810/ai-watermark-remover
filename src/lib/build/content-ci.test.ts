import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { parseEntry, markdownIssues, htmlIssues, inspectImage } from '../content-api/validation';
import { readContentVersions } from '../../../scripts/lib/content-ci-versions.mjs';
import { changedFiles } from '../../../scripts/ci-plan.mjs';
import { execFileSync } from 'node:child_process';

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
        const { current: entry, previous } = readContentVersions(process.env.BASE_SHA!, process.env.HEAD_SHA!, file);
        const kind = file.startsWith('src/content/blog/') ? 'blog' : 'landing';
        expect(() => parseEntry(kind, entry, String(entry.data.slug), previous)).not.toThrow();
      });
    } else if (/^public\/uploads\/.+\.(?:png|jpe?g|webp|gif|avif)$/i.test(file)) {
      it(`decodes the original changed image without rewriting bytes: ${file}`, async () => {
        const bytes = execFileSync('git', ['show', `${process.env.HEAD_SHA}:${file}`], { maxBuffer: 100_000_000 });
        const image = sharp(bytes, { limitInputPixels: 100_000_000 });
        expect((await image.metadata()).format).toMatch(/^(png|jpeg|webp|gif|heif)$/);
        await expect(image.stats()).resolves.toHaveProperty('channels');
        const match = /^public\/uploads\/content-api\/([a-f0-9]{24})\//.exec(file);
        if (match) {
          const audit = JSON.parse(execFileSync('git', ['show', `${process.env.HEAD_SHA}:.content-api/${match[1]}.json`], { encoding: 'utf8' }));
          const asset = audit.assets.find((item: { path: string }) => `public${item.path}` === file);
          expect(asset).toBeDefined();
          const actual = await inspectImage(bytes, asset.mime);
          expect(actual).toMatchObject({ width: asset.width, height: asset.height, bytes: asset.bytes, mime: asset.mime });
        }
      });
    }
  }
});
