import { z } from 'zod';

const navigationLinkSchema = z.object({
  label: z.string().min(1),
  href: z.string().min(1),
});

const headerNavigationItemSchema = z.object({
  label: z.string().min(1),
  href: z.string().default(''),
  children: z.array(navigationLinkSchema).default([]),
}).superRefine((item, context) => {
  if (item.children.length === 0 && item.href.length === 0) {
    context.addIssue({ code: 'custom', path: ['href'], message: 'A normal navigation link requires a URL.' });
  }
});

export const siteSettingsSchema = z.object({
  name: z.string().min(1),
  brandMark: z.string().min(1),
  defaultTitle: z.string().min(1),
  defaultDescription: z.string().min(1).max(180),
  favicon: z.string().min(1),
  defaultShareImage: z.string().min(1),
  announcement: z.object({
    enabled: z.boolean(),
    text: z.string().min(1),
    linkLabel: z.string(),
    linkHref: z.string(),
  }),
  header: z.object({
    navigation: z.array(headerNavigationItemSchema).min(1),
  }),
  footer: z.object({
    tagline: z.string().min(1),
    links: z.array(navigationLinkSchema).min(1),
  }),
});

export type SiteSettings = z.infer<typeof siteSettingsSchema>;
