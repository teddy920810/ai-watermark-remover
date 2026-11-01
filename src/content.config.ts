import { blogEntrySchema, landingEntrySchema } from './lib/content/entry-schemas';
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { fileURLToPath } from 'node:url';
import { assertCmsPublication } from '../scripts/cms-publication.mjs';
import { homepageSchema } from './lib/content/homepage';
import { siteSettingsSchema } from './lib/content/site-settings';
import { imageSettingsSchema } from './lib/content/image-metadata';
import { sitemapSettingsSchema } from './lib/content/sitemap-settings';
import {
  blogIndexSettingsSchema,
  legalPageSchema,
  notFoundSettingsSchema,
} from './lib/content/marketing-settings';

// Applies to astro sync, CMS validation, CI and every deployment build.
assertCmsPublication(fileURLToPath(new URL('..', import.meta.url)));

const siteSettings = defineCollection({
  loader: glob({ base: './src/content/settings', pattern: 'site.json' }),
  schema: siteSettingsSchema,
});

const imageSettings = defineCollection({
  loader: glob({ base: './src/content/settings', pattern: 'images.json' }),
  schema: imageSettingsSchema,
});

const blogIndexSettings = defineCollection({
  loader: glob({ base: './src/content/settings', pattern: 'blog.json' }),
  schema: blogIndexSettingsSchema,
});

const notFoundSettings = defineCollection({
  loader: glob({ base: './src/content/settings', pattern: 'not-found.json' }),
  schema: notFoundSettingsSchema,
});

const sitemapSettings = defineCollection({
  loader: glob({ base: './src/content/settings', pattern: 'sitemap.json' }),
  schema: sitemapSettingsSchema,
});

const legalPages = defineCollection({
  loader: glob({ base: './src/content/legal', pattern: '**/*.{md,mdx}' }),
  schema: legalPageSchema,
});

const homepage = defineCollection({
  loader: glob({ base: './src/content/homepage', pattern: '**/*.json' }),
  schema: homepageSchema,
});

const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
  schema: blogEntrySchema,
});

const landingPages = defineCollection({
  loader: glob({ base: './src/content/landing-pages', pattern: '**/*.json' }),
  schema: landingEntrySchema,
});

export const collections = {
  siteSettings,
  imageSettings,
  blogIndexSettings,
  notFoundSettings,
  sitemapSettings,
  legalPages,
  homepage,
  blog,
  landingPages,
};
