import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { resolveAppEntry } from '../../components/workspace/app-entry';
import { resolveImagePair } from './image-pair';
import baseline from '../../../tests/fixtures/seo-content-baseline.json';

const read = (file: string) => fs.readFileSync(file, 'utf8');
describe('unified file entry and content migration', () => {
  it('keeps operational uploader controls out of CMS while preserving stored compatibility fields on save', () => {
    const config = YAML.parse(read('.pages.yml'));
    expect(config.settings.content.merge).toBe(true);
    for (const name of ['site-settings', 'homepage', 'landing-pages']) expect(config.content.find((entry: { name: string }) => entry.name === name).fields.some((field: { name: string }) => field.name === 'uploader')).toBe(false);
  });
  it('treats source recommendations as hints and explains incompatible or unavailable recommendations', () => {
    const recommended = { operation: 'background-removal' as const };
    expect(resolveAppEntry({ kind: 'image', recommendation: recommended }).operation).toBe('background-removal');
    expect(resolveAppEntry({ kind: 'video', recommendation: recommended })).toMatchObject({ operation: 'video-watermark', notice: expect.stringMatching(/compatible|video/i) });
    expect(resolveAppEntry({ kind: 'image', recommendation: { operation: 'image-watermark', unavailable: true } })).toMatchObject({ operation: 'image-watermark', notice: expect.stringMatching(/not available|not open|unavailable/i) });
    expect(resolveAppEntry({ kind: 'video', hasJob: true, recommendation: { ...recommended, unavailable: true } })).toEqual({ operation: 'video-watermark' });
  });
  it('honors the legacy comparison image override while migrating real sources', () => {
    expect(resolveImagePair({ image: '/uploads/fallback.png', comparison: { image: '/uploads/actual-after.png', beforeImage: '/uploads/actual-before.png' } })).toEqual({ image: '/uploads/actual-before.png', afterImage: '/uploads/actual-after.png' });
  });
  it('preserves the historical asset review and covers its content references in the independent baseline', () => {
    const manifest = JSON.parse(read('docs/product/CONTENT_MEDIA_MIGRATION.json')) as { items: Array<{ image: string; classification: string; references: Array<{ file: string }>; resolution?: unknown; review?: { status: string } }> };
    expect(manifest.items).toHaveLength(166);
    expect(manifest.items.filter(item => item.classification === 'baked-controls-replace')).toHaveLength(52);
    expect(manifest.items.filter(item => item.classification === 'missing-fallback')).toHaveLength(1);
    const pending = manifest.items.filter(item => ['baked-controls-replace', 'missing-fallback'].includes(item.classification));
    for (const item of pending) {
      expect(item.resolution).toBeUndefined();
      expect(item.review?.status).toBe('operator-seo-pending');
    }
    const historicalContentFiles = [...new Set(pending.flatMap(item => item.references.map(reference => reference.file)))];
    expect(historicalContentFiles).toHaveLength(27);
    for (const file of historicalContentFiles) {
      // seo-content-ownership.test.ts checks each file's semantic hash; do not duplicate that authority here.
      expect(baseline.files.filter(entry => entry.file === file), file).toHaveLength(1);
    }
  });
  it('keeps original resources and records the already missing asset without substituting it', () => {
    const manifest = JSON.parse(read('docs/product/CONTENT_MEDIA_MIGRATION.json')) as { items: Array<{ image: string; classification: string }>; replacementStatus: { replacements: number; revokedReplacements: number } };
    expect(manifest.replacementStatus).toMatchObject({ replacements: 0, revokedReplacements: 53 });
    for (const item of manifest.items) {
      expect(fs.existsSync(path.join('public', item.image)), item.image).toBe(item.classification !== 'missing-fallback');
    }
  });
  it('uses one image renderer and never creates synthetic Before overlays in public templates', () => {
    for (const file of ['src/pages/index.astro', 'src/components/LandingPage.astro']) {
      expect(read(file)).not.toMatch(/import (?:HomeComparison|LandingComparison)/);
      expect(read(file)).not.toMatch(/watermark=|comparisonStyle=/);
    }
    for (const file of ['src/lib/home-interactions.ts', 'src/lib/landing-interactions.ts']) expect(read(file)).not.toMatch(/data-(?:home|landing)-compare/);
    // Legacy fields remain stored content; templates must not turn them into synthetic overlays.
  });
});
