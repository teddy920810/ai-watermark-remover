import { z } from 'zod';

const canonicalOriginSchema = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === 'https:' && url.pathname === '/' && !url.search && !url.hash;
}, 'Canonical origin must be an HTTPS origin without a path, query, or hash.');

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

const uploaderCopySchema = z.object({
  hero: z.object({
    eyebrow: z.string().min(1), heading: z.string().min(1), demoBadge: z.string().min(1), demoBadgeTitle: z.string().min(1),
  }),
  dropzone: z.object({
    dropLabel: z.string().min(1), browseLabel: z.string().min(1), formatLabel: z.string().min(1), maxSizeLabel: z.string().min(1), fileInputLabel: z.string().min(1),
  }),
  preview: z.object({
    altTemplate: z.string().min(1), processingLabel: z.string().min(1), readyLabel: z.string().min(1), removeButton: z.string().min(1), uploadingButton: z.string().min(1), processingButton: z.string().min(1), chooseAnotherButton: z.string().min(1),
  }),
  result: z.object({
    originalLabel: z.string().min(1), resultLabel: z.string().min(1), originalAlt: z.string().min(1), resultAlt: z.string().min(1), demoNote: z.string().min(1), downloadButton: z.string().min(1), processAnotherButton: z.string().min(1),
  }),
  auth: z.object({
    closeLabel: z.string().min(1), title: z.string().min(1), description: z.string().min(1), connectingButton: z.string().min(1), continueButton: z.string().min(1), dismissButton: z.string().min(1),
  }),
  privacyNote: z.string().min(1),
});

export type UploaderCopy = z.infer<typeof uploaderCopySchema>;

export const siteSettingsSchema = z.object({
  name: z.string().min(1),
  canonicalOrigin: canonicalOriginSchema,
  locale: z.string().min(2),
  themeColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  themeColorFallback: z.string().regex(/^#[0-9a-f]{6}$/i),
  logo: z.string().min(1),
  defaultTitle: z.string().min(1),
  defaultDescription: z.string().min(1).max(180),
  favicon: z.string().min(1),
  defaultShareImage: z.string().min(1),
  analytics: z.object({
    googleMeasurementId: z.union([z.literal(''), z.string().regex(/^G-[A-Z0-9]+$/)]),
  }),
  structuredData: z.object({
    applicationCategory: z.string().min(1),
    operatingSystem: z.string().min(1),
    price: z.string().min(1),
    priceCurrency: z.string().regex(/^[A-Z]{3}$/),
  }),
  contentDefaults: z.object({
    author: z.string().min(1),
    category: z.string().min(1),
  }),
  uploader: uploaderCopySchema,
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
