import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { siteSettingsSchema } from './site-settings';

const settings = JSON.parse(
  readFileSync(new URL('../../content/settings/site.json', import.meta.url), 'utf8'),
);

describe('site settings CMS content', () => {
  it('matches the site settings schema', () => {
    expect(siteSettingsSchema.safeParse(settings).success).toBe(true);
  });

  it('contains the CMS-managed site sections required to render the shared layout', () => {
    const parsed = siteSettingsSchema.parse(settings);
    expect(parsed.locale).toMatch(/\S/);
    expect(new URL(parsed.canonicalOrigin).protocol).toBe('https:');
    expect(parsed.themeColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(parsed.themeColorFallback).toMatch(/^#[0-9a-f]{6}$/i);
    expect(parsed.name).toMatch(/\S/);
    expect(parsed.logo).toMatch(/\S/);
    expect(parsed.defaultShareImage).toMatch(/\S/);
    expect(parsed.header.navigation.length).toBeGreaterThan(0);
    expect(parsed.footer.groups.length).toBeGreaterThan(0);
    expect(parsed.footer.groups.every((group) => group.links.length > 0)).toBe(true);
    expect(parsed.processVisuals).toHaveLength(3);
    expect(parsed.cta.heading).toBeTruthy();
    expect(parsed.uploader.hero.heading).toBeTruthy();
    expect(parsed.uploader.dropzone.fileInputLabel).toBeTruthy();
  });

  it('requires a canonical HTTPS origin without a path', () => {
    const invalid = structuredClone(settings);
    invalid.canonicalOrigin = 'https://www.watermarkgemini.com/blog';
    expect(siteSettingsSchema.safeParse(invalid).success).toBe(false);
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

  it('lists every tool exactly once and marks only unopened tools Coming Soon', () => {
    const children = siteSettingsSchema.parse(settings).header.navigation.flatMap((item) => item.children);
    const directory = new URL('../../content/landing-pages/', import.meta.url);
    for (const filename of readdirSync(directory).filter((file) => file.endsWith('.json'))) {
      const page = JSON.parse(readFileSync(new URL(filename, directory), 'utf8'));
      if (page.draft) continue;
      const matches = children.filter((link) => link.href === `/${page.slug}`);
      expect(matches, page.slug).toHaveLength(1);
      expect(matches[0], page.slug).toMatchObject(page.statusLabel ? { badge: page.statusLabel } : { label: expect.any(String) });
      if (!page.statusLabel) expect(matches[0]).not.toHaveProperty('badge');
    }
    expect(children.some((link) => link.label === 'All Watermark Tools' || link.href === '/')).toBe(false);
  });

  it('groups image editing, image watermarks, and video or batch tools by intent', () => {
    const navigation = settings.header.navigation as Array<{
      label: string;
      href?: string;
      children?: Array<{ label: string; href: string }>;
    }>;
    const imageTools = navigation.find((item) => item.label === 'Image Tools');
    const watermarkTools = navigation.find((item) => item.label === 'Watermark Removers');
    const childHrefs = navigation.flatMap((item) => item.children?.map((child) => child.href) ?? []);

    expect(imageTools?.children?.map((item) => item.href)).toEqual([
      '/remove-background',
      '/remove-object',
      '/remove-text-from-image',
      '/remove-logo-from-image',
    ]);
    expect(watermarkTools?.children?.map((item) => item.href)).toEqual([
      '/chatgpt-watermark-remover',
      '/gemini-watermark-remover',
      '/grok-watermark-remover',
      '/notebooklm-watermark-remover',
      '/pdf-watermark-remover',
      '/shutterstock-watermark-remover',
    ]);
    expect(navigation.find((item) => item.label === 'Video & Batch Tools')?.children).toHaveLength(10);
    expect(childHrefs).toEqual(expect.arrayContaining([
      '/batch-watermark-remover',
      '/capcut-watermark-remover',
      '/facebook-watermark-remover',
      '/instagram-watermark-remover',
      '/sora-watermark-remover',
      '/veo-watermark-remover',
      '/kling-watermark-remover',
      '/remove-subtitle-from-video',
      '/tiktok-watermark-remover',
      '/video-watermark-remover',
    ]));
  });
});

