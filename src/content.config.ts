import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'zod';
import { publishedAtSchema } from './lib/content/published-date';
import { homepageSchema } from './lib/content/homepage';
import { siteSettingsSchema } from './lib/content/site-settings';
import { imageSettingsSchema } from './lib/content/image-metadata';
import { trustedHtmlSchema } from './lib/content/trusted-html';
import { sitemapSettingsSchema } from './lib/content/sitemap-settings';
import {
  blogIndexSettingsSchema,
  landingCommonSettingsSchema,
  legalPageSchema,
  notFoundSettingsSchema,
} from './lib/content/marketing-settings';

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

const landingCommonSettings = defineCollection({
  loader: glob({ base: './src/content/settings', pattern: 'landing.json' }),
  schema: landingCommonSettingsSchema,
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

const blogEntrySchema = z.object({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: z.string().min(1),
    description: z.string().min(1),
    publishedAt: publishedAtSchema,
    updatedAt: publishedAtSchema.optional(),
    readTime: z.string().min(1),
    coverImage: z.string().min(1).optional(),
    coverAlt: z.string().min(1).optional(),
    author: z.string().min(1).optional(),
    category: z.string().min(1).optional(),
    contentMode: z.enum(['markdown', 'html']).default('markdown'),
    bodyHtml: trustedHtmlSchema.optional(),
    featured: z.boolean().default(false),
    draft: z.boolean().default(false),
  }).superRefine((post, context) => {
    if (post.contentMode === 'html' && !post.bodyHtml) {
      context.addIssue({ code: 'custom', path: ['bodyHtml'], message: 'HTML content is required in HTML mode.' });
    }
  });

const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
  schema: blogEntrySchema,
});

const faqItem = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
});

const landingFeatureItemSchema = z.object({
  eyebrow: z.string().min(1),
  heading: z.string().min(1),
  description: z.string().min(1),
  listItems: z.array(z.string().min(1)).default([]),
  image: z.string().min(1),
  imageAlt: z.string().min(1),
  imagePosition: z.enum(['left', 'right']).default('right'),
});

const landingFeaturesSchema = z.object({
  eyebrow: z.string().min(1),
  heading: z.string().min(1),
  intro: z.string().min(1),
  items: z.array(landingFeatureItemSchema).min(1),
});

const landingPages = defineCollection({
  loader: glob({ base: './src/content/landing-pages', pattern: '**/*.json' }),
  schema: z.object({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: z.string().min(1),
    description: z.string().min(1),
    eyebrow: z.string().min(1),
    heading: z.string().min(1),
    intro: z.string().min(1),
    benefits: z.array(z.string().min(1)).min(1),
    features: landingFeaturesSchema.optional(),
    faq: z.array(faqItem).min(1),
  }),
});

export const collections = {
  siteSettings,
  imageSettings,
  blogIndexSettings,
  landingCommonSettings,
  notFoundSettings,
  sitemapSettings,
  legalPages,
  homepage,
  blog,
  landingPages,
};
