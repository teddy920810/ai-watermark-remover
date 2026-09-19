import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

const slug = 'how-to-remove-gpt-image-2-5-grain-noise';
const imageHashes = [
  '8507bce792d035fa3c26ad5f333785e9a8caeb8430a2c20dbbe38b313a0e05d2',
  'f78df4ee71e2850de4de802cb88c63c9cc48110e2cbcd5e8ff5f4cc97c9ae16f',
  '8dd66dd6d80a3816d830d1d820f4947b59258290a4c42e87a072aef84dad3d73',
  'cc09bceba3d552ec4fad5c4336a563648a344e67a4ab90d277faba16e6bdaebd',
];

describe('operations GPT Image grain noise article', () => {
  it('publishes the requested route with source metadata, sections and table', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/content/blog', `${slug}.md`), 'utf8');
    const [, frontmatter, body] = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)!;
    const data = YAML.parse(frontmatter);
    expect(data.slug).toBe(slug);
    expect(data.title).toBe('How to Fix GPT Image 2.5 Grain Noise');
    expect(data.description).toBe('Fix unwanted GPT Image 2.5 grain noise with a focused re-edit, a clearer regeneration prompt, or a light local adjustment. Learn what to check before export.');
    expect(data.draft).toBe(false);
    expect(data.coverImage).toBe(`/uploads/${slug}-figure-1.png`);
    expect(body).not.toMatch(/^(?:Meta description|Slug):/m);
    expect(body.match(/^## /gm)).toHaveLength(11);
    expect(body).toContain('Q4: How do I remove grain from GPT Image 2.5 without over-smoothing it?');
    expect(source).toContain('Preserves the useful image while naming the affected area');
    expect(source).toContain('https://support.apple.com/guide/photos/reduce-noise-phta85f0d224/mac');
    expect(source).toContain('https://www.watermarkgemini.com/terms');
    for (let index = 1; index <= 4; index++) expect(source).toContain(`/uploads/${slug}-figure-${index}.png`);
  });

  it('preserves all four original Word images byte for byte', () => {
    for (const [index, hash] of imageHashes.entries()) {
      const image = fs.readFileSync(path.join(process.cwd(), 'public/uploads', `${slug}-figure-${index + 1}.png`));
      expect(createHash('sha256').update(image).digest('hex')).toBe(hash);
    }
  });
});
