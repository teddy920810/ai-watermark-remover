import { z } from 'zod';
import { imagePairFields, validateImagePair } from './image-pair';
import { publishedAtSchema } from './published-date';
import { landingComparisonSchema, landingDesignFields } from './landing-design';
import { siteCtaSchema, uploaderCopyOverrideSchema } from './site-settings';
import { trustedHtmlSchema } from './trusted-html';

export const blogEntrySchema = z.object({
    templateVersion: z.literal(1).optional(),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: z.string().min(1),
    seoTitle: z.string().min(1).optional(),
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

const faqItem = z.object({
  enabled: z.boolean().default(true),
  question: z.string().min(1),
  answer: z.string().min(1),
});

const landingFeatureItemSchema = z.object({
  enabled: z.boolean().default(true),
  eyebrow: z.string().min(1),
  heading: z.string().min(1),
  description: z.string().min(1),
  listItems: z.array(z.string().min(1)).default([]),
  image: z.string().min(1),
  afterImage: imagePairFields.afterImage,
  afterImageAlt: imagePairFields.afterImageAlt,
  imageAlt: z.string().min(1),
  imagePosition: z.enum(['left', 'right']).default('right'),
  comparison: landingComparisonSchema.optional(),
}).superRefine(validateImagePair);

const landingFeaturesSchema = z.object({
  eyebrow: z.string().min(1),
  heading: z.string().min(1),
  intro: z.string().min(1),
  items: z.array(landingFeatureItemSchema).min(1),
});

export const landingEntrySchema = z.object({
    ...landingDesignFields,
    templateVersion: z.literal(1).optional(),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    draft: z.boolean().default(false),
    toolKind: z.enum(['watermark-remover', 'video-watermark-remover', 'background-remover', 'object-remover']).default('watermark-remover'),
    title: z.string().min(1),
    description: z.string().min(1),
    eyebrow: z.string().min(1),
    statusLabel: z.string().min(1).optional(),
    heading: z.string().min(1),
    intro: z.string().min(1),
    toolNote: z.string().min(1).optional(),
    uploadButtonLabel: z.string().min(1).optional(),
    shareImage: z.string().min(1).optional(),
    benefits: z.array(z.string().min(1)).min(1),
    heroActions: z.array(z.object({ label: z.string().min(1), href: z.string().min(1) })).min(1).max(2).optional(),
    uploader: uploaderCopyOverrideSchema.optional(),
    process: z.object({
      eyebrow: z.string().min(1),
      heading: z.string().min(1),
      intro: z.string().min(1),
      steps: z.array(z.object({
        number: z.string().min(1),
        title: z.string().min(1),
        description: z.string().min(1),
        image: z.string().min(1).optional(),
        afterImage: imagePairFields.afterImage,
        afterImageAlt: imagePairFields.afterImageAlt,
        imageAlt: z.string().min(1).optional(),
      }).superRefine(validateImagePair)).length(3),
    }),
    features: landingFeaturesSchema.optional(),
    scope: z.object({
      eyebrow: z.string().min(1),
      heading: z.string().min(1),
      intro: z.string().min(1),
      items: z.array(z.object({ heading: z.string().min(1), description: z.string().min(1) })).min(1),
    }).optional(),
    cta: siteCtaSchema.optional(),
    faq: z.object({
      eyebrow: z.string().min(1),
      heading: z.string().min(1),
      intro: z.string().min(1),
      items: z.array(faqItem).min(1),
    }),
  });
