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
    expect(parsed.locale).toBe('en');
    expect(parsed.themeColor).toBe('#f7f5ef');
    expect(parsed.analytics.googleMeasurementId).toBe('G-52ZWCGEZ7R');
    expect(parsed.structuredData.applicationCategory).toBe('MultimediaApplication');
    expect(parsed.contentDefaults.author).toBe('ClearMark AI');
    expect(parsed.logo).toBe('/uploads/watermarkgemini-logo.svg');
    expect(parsed.defaultShareImage).toBe('/uploads/og-card.svg');
    expect(parsed.header.navigation.length).toBeGreaterThan(0);
    expect(parsed.footer.links.length).toBeGreaterThan(0);
    expect(parsed.announcement.enabled).toBe(false);
  });

  it('allows analytics to be disabled but rejects malformed measurement IDs', () => {
    const disabled = structuredClone(settings);
    disabled.analytics.googleMeasurementId = '';
    expect(siteSettingsSchema.safeParse(disabled).success).toBe(true);

    const malformed = structuredClone(settings);
    malformed.analytics.googleMeasurementId = 'UA-123';
    expect(siteSettingsSchema.safeParse(malformed).success).toBe(false);
  });

  it('supports one-level dropdown links in the header navigation', () => {
    const dropdownSettings = structuredClone(settings);
    dropdownSettings.header.navigation[0].children = [
      { label: 'Remove logos', href: '/remove-logo-from-image' },
      { label: 'Remove text', href: '/remove-text-from-image' },
    ];

    const parsed = siteSettingsSchema.parse(dropdownSettings);
    expect(parsed.header.navigation[0].children).toHaveLength(2);
  });
});

