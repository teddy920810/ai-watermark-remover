import { describe, expect, it } from 'vitest';
import { imagePairSchema, resolveImagePair } from './image-pair';
import { readFileSync } from 'node:fs';
import YAML from 'yaml';
import { homepageSchema } from './homepage';

describe('single and true two-image content', () => {
  it('supports zero, one and two independent sources and rejects an orphan or repeated After', () => {
    expect(imagePairSchema.parse({})).toEqual({});
    expect(imagePairSchema.parse({ image: '/uploads/before.png' })).toEqual({ image: '/uploads/before.png' });
    expect(imagePairSchema.safeParse({ image: '/uploads/before.png', afterImage: '/uploads/after.png' }).success).toBe(true);
    expect(imagePairSchema.safeParse({ afterImage: '/uploads/after.png' }).success).toBe(false);
    expect(imagePairSchema.safeParse({ image: '/uploads/same.png', afterImage: '/uploads/same.png' }).success).toBe(false);
    expect(imagePairSchema.safeParse({ image: '/uploads/a.png', watermark: 'pretend' }).success).toBe(false);
    expect(imagePairSchema.parse({ image: '/uploads/before.png', afterImage: '' })).toEqual({ image: '/uploads/before.png', afterImage: undefined });
  });
  it('adapts real legacy pairs and makes legacy illustrative overlays static in the new model', () => {
    expect(resolveImagePair({ image: '/uploads/clean.png', comparison: { beforeImage: '/uploads/original.png' } })).toEqual({ image: '/uploads/original.png', afterImage: '/uploads/clean.png' });
    expect(resolveImagePair({ image: '/uploads/clean.png', comparison: { style: 'gemini', watermark: 'GEMINI' } })).toEqual({ image: '/uploads/clean.png' });
    expect(resolveImagePair({ image: '/uploads/new-before.png', afterImage: '/uploads/new-after.png', comparison: { beforeImage: '/uploads/old.png' } })).toEqual({ image: '/uploads/new-before.png', afterImage: '/uploads/new-after.png' });
  });
  it('exposes Image 1 and optional Image 2 to CMS without new illustrative overlay controls', () => {
    const config = YAML.parse(readFileSync(new URL('../../../.pages.yml', import.meta.url), 'utf8'));
    for (const collection of config.content.filter((entry: { name: string }) => ['homepage', 'landing-pages'].includes(entry.name))) {
      let imageGroups = 0;
      function inspect(fields: Array<{ name: string; type?: string; fields?: typeof fields; label?: string }>) {
        if (fields.some(field => field.name === 'image')) {
          imageGroups++;
          expect(fields.find(field => field.name === 'afterImage')?.type).toBe('image');
          expect(fields.map(field => field.name)).not.toEqual(expect.arrayContaining(['watermark']));
          expect(fields.find(field => field.name === 'comparisonStyle' || field.name === 'comparison')).toBeUndefined();
        }
        fields.forEach(field => { if (field.fields) inspect(field.fields); });
      }
      inspect(collection.fields); expect(imageGroups).toBeGreaterThan(0);
    }
  });
  it('never invents an overlay for a newly entered single-image home record', () => {
    const home = JSON.parse(readFileSync(new URL('../../content/homepage/home.json', import.meta.url), 'utf8'));
    delete home.hero.samples[0].watermark;
    delete home.useCases[0].watermark; delete home.useCases[0].comparisonStyle;
    delete home.features.items[0].watermark; delete home.features.items[0].comparisonStyle;
    const parsed = homepageSchema.parse(home);
    expect(parsed.hero.samples[0].watermark).toBeUndefined();
    expect(parsed.useCases[0].watermark).toBeUndefined(); expect(parsed.useCases[0].comparisonStyle).toBeUndefined();
    expect(parsed.features.items[0].watermark).toBeUndefined();
  });
});
