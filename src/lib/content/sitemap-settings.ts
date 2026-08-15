import { z } from 'zod';
import { publishedAtSchema } from './published-date';

export const sitemapChangeFrequencySchema = z.enum([
  'always',
  'hourly',
  'daily',
  'weekly',
  'monthly',
  'yearly',
  'never',
]);
export type SitemapChangeFrequency = z.infer<typeof sitemapChangeFrequencySchema>;

const sitemapRuleSchema = z.object({
  changefreq: sitemapChangeFrequencySchema,
  priority: z.number().min(0).max(1),
});

export const sitemapSettingsSchema = z.object({
  lastmod: publishedAtSchema,
  groups: z.object({
    homepage: sitemapRuleSchema,
    landingPages: sitemapRuleSchema,
    blogIndex: sitemapRuleSchema,
    blogPosts: sitemapRuleSchema,
    legalPages: sitemapRuleSchema,
  }),
  overrides: z.array(z.object({
    path: z.string().regex(/^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*)?$/),
    lastmod: publishedAtSchema.optional(),
    changefreq: sitemapChangeFrequencySchema.optional(),
    priority: z.number().min(0).max(1).optional(),
  })).default([]),
});

export type SitemapSettings = z.infer<typeof sitemapSettingsSchema>;
