import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LauncherPrompt, launcherCopy } from './launcher-copy';
import { resolveUploaderCopy, siteSettingsSchema } from '../../lib/content/site-settings';
const site = siteSettingsSchema.parse(JSON.parse(readFileSync(new URL('../../content/settings/site.json', import.meta.url), 'utf8')));
describe('CMS launcher copy', () => {
  it('renders resolved page-specific drop, browse, and accessible file labels', () => {
    const copy = resolveUploaderCopy(site.uploader, { dropzone: { dropLabel: 'Drop a catalog image here', browseLabel: 'or select your catalog photo', fileInputLabel: 'Select a catalog photo' } });
    const html = renderToStaticMarkup(createElement(LauncherPrompt, { kind: 'image', copy }));
    expect(html).toContain('Drop a catalog image here');
    expect(html).toContain('or select your catalog photo');
    expect(launcherCopy('image', copy).fileInputLabel).toBe('Select a catalog photo');
  });
});
