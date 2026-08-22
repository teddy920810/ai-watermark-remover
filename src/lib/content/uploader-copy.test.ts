import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  resolveUploaderCopy,
  siteSettingsSchema,
  uploaderCopyOverrideSchema,
} from './site-settings';

const settings = siteSettingsSchema.parse(JSON.parse(
  readFileSync(new URL('../../content/settings/site.json', import.meta.url), 'utf8'),
));

describe('page-specific uploader copy', () => {
  it('uses every shared value when a page has no override', () => {
    expect(resolveUploaderCopy(settings.uploader)).toEqual(settings.uploader);
  });

  it('overrides individual fields while inheriting the remaining shared values', () => {
    const override = uploaderCopyOverrideSchema.parse({
      hero: { heading: 'Page-specific uploader heading' },
      dropzone: { dropLabel: 'Drop this page image here' },
    });

    expect(resolveUploaderCopy(settings.uploader, override)).toEqual({
      ...settings.uploader,
      hero: { ...settings.uploader.hero, heading: 'Page-specific uploader heading' },
      dropzone: { ...settings.uploader.dropzone, dropLabel: 'Drop this page image here' },
    });
  });

  it('treats empty CMS fields as inherit-from-shared values', () => {
    const override = uploaderCopyOverrideSchema.parse({
      hero: { heading: '' },
      privacyNote: '',
    });

    expect(resolveUploaderCopy(settings.uploader, override)).toEqual(settings.uploader);
  });
});
