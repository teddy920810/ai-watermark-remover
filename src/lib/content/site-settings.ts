import { z } from 'zod';

const navigationLinkSchema = z.object({
  label: z.string().min(1),
  href: z.string().min(1),
});

export const siteSettingsSchema = z.object({
  name: z.string().min(1),
  brandMark: z.string().min(1),
  defaultTitle: z.string().min(1),
  defaultDescription: z.string().min(1).max(180),
  favicon: z.string().min(1),
  defaultShareImage: z.string().min(1),
  header: z.object({
    navigation: z.array(navigationLinkSchema).min(1),
  }),
  footer: z.object({
    tagline: z.string().min(1),
    links: z.array(navigationLinkSchema).min(1),
  }),
});

export type SiteSettings = z.infer<typeof siteSettingsSchema>;
