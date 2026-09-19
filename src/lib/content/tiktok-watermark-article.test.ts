import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

const slug = 'how-to-remove-tiktok-watermark';
const imageHashes = [
  '86b319cdcfe2b90f80fff76b8591e8c2d1e6c64888911da35e204217cfa82905',
  '13cfbe1083b4930c0f42d0e3991c2af305773d1786a400185b31af74ef57da84',
  'a8be87820edebd1dca5c24fc4343464cafa4c88062b4c74cdcbe0deae19264fc',
  '48051e572994978bbe3de4a909ba7788e7d1b56acd2c01d5085f0b35d2031f6c',
];

describe('operations TikTok watermark article', () => {
  it('publishes the supplied metadata and retains the video versus still-image distinction', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/content/blog', `${slug}.md`), 'utf8');
    const [, frontmatter, body] = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)!;
    const data = YAML.parse(frontmatter);
    expect(data.slug).toBe(slug);
    expect(data.title).toBe('How to Remove a TikTok Watermark From a Video You Own');
    expect(data.seoTitle).toBe('How to Remove TikTok Watermarks From Your Own Videos');
    expect(data.description).toBe('Remove a TikTok watermark from your own saved video. Compare editing, cropping and cover options, check quality, and clean separate still images.');
    expect(data.draft).toBe(false);
    expect(data.coverImage).toBe(`/uploads/${slug}-figure-1.png`);
    expect(body).not.toMatch(/^(?:SEO title|Meta description|Slug|Primary keyword|Secondary cluster):/m);
    expect(body.match(/^## /gm)).toHaveLength(9);
    expect(body).toContain('Image-only route; TikTok video feature Coming Soon');
    expect(body).toContain('Not for: video files, a batch of images, TikTok URLs');
    expect(body.replace(/\*\*/g, '')).toContain('Q5: How to remove the TikTok watermark for free');
    expect(body).toContain('https://www.watermarkgemini.com/tiktok-watermark-remover');
    for (let index = 1; index <= 4; index++) expect(source).toContain(`/uploads/${slug}-figure-${index}.png`);
  });

  it('preserves all four original Word images byte for byte', () => {
    for (const [index, hash] of imageHashes.entries()) {
      const image = fs.readFileSync(path.join(process.cwd(), 'public/uploads', `${slug}-figure-${index + 1}.png`));
      expect(createHash('sha256').update(image).digest('hex')).toBe(hash);
    }
  });
});
