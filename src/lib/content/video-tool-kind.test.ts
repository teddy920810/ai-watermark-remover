import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { collectPublicationIssues, reservedToolSlugs } from '../../../scripts/cms-publication.mjs';
describe('video landing operation identity', () => {
  it('keeps video operation identity explicit and editable in the shared content contract', () => {
    const page = JSON.parse(readFileSync('src/content/landing-pages/video-watermark-remover.json', 'utf8'));
    expect(page.toolKind).toBe('video-watermark-remover');
    expect(readFileSync('src/content.config.ts', 'utf8')).toContain("'video-watermark-remover'");
    const config = YAML.parse(readFileSync('.pages.yml', 'utf8'));
    expect(config.content.find((c: { name: string }) => c.name === 'landing-pages').fields.find((f: { name: string }) => f.name === 'toolKind').options.values).toContainEqual({ name: 'video-watermark-remover', label: 'Video watermark remover' });
  });
  it('protects the app workspace route from CMS slugs even for drafts', () => {
    expect(reservedToolSlugs.has('app')).toBe(true);
    expect(collectPublicationIssues([{ path: 'src/content/landing-pages/app.json', data: { slug: 'app', draft: true } }]).join()).toContain('reserved');
  });
});
