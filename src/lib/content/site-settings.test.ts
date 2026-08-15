import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { siteSettingsSchema } from './site-settings';

const settings = JSON.parse(
  readFileSync(new URL('../../content/settings/site.json', import.meta.url), 'utf8'),
);

describe('site settings CMS content', () => {
  it('matches the site settings schema', () => {
    expect(siteSettingsSchema.safeParse(settings).success).toBe(true);
  });

  it('contains editable header navigation and footer links', () => {
    const parsed = siteSettingsSchema.parse(settings);
    expect(parsed.header.navigation.length).toBeGreaterThan(0);
    expect(parsed.footer.links.length).toBeGreaterThan(0);
    expect(parsed.announcement.enabled).toBe(false);
  });
});
