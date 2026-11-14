import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const directory = new URL('../../content/landing-pages/', import.meta.url);
// The 2026-11-14 operations package explicitly restores these page-local labels.
const operatorLabels: Record<string, string> = {
  'facebook-watermark-remover.json': 'FACEBOOK WATERMARK REMOVER · COMING SOON',
  'kling-watermark-remover.json': 'KLING WATERMARK REMOVER · Coming Soon',
  'remove-subtitle-from-video.json': 'REMOVE SUBTITLE FROM VIDEO · COMING SOON',
  'sora-watermark-remover.json': 'SORA WATERMARK REMOVER · Coming Soon',
  'tiktok-watermark-remover.json': 'TIKTOK WATERMARK REMOVER · Coming Soon',
  'veo-watermark-remover.json': 'VEO WATERMARK REMOVER · Coming Soon',
};

describe('tool status copy requested by the content owner', () => {
  it.each(readdirSync(directory).filter(file => file.endsWith('.json')))('preserves the content-owner availability wording in %s', file => {
    const page = JSON.parse(readFileSync(new URL(file, directory), 'utf8'));
    if (operatorLabels[file]) {
      expect(page.eyebrow).toBe(operatorLabels[file]);
      expect(page.statusLabel).toBeUndefined();
    } else expect(JSON.stringify(page)).not.toMatch(/coming\s+soon/i);
  });

  it('removes Coming Soon from every header navigation link', () => {
    const site = JSON.parse(readFileSync(new URL('../../content/settings/site.json', import.meta.url), 'utf8'));
    expect(JSON.stringify(site.header.navigation)).not.toMatch(/coming\s+soon/i);
  });
});
