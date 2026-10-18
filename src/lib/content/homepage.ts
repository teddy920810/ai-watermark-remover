import { z } from 'zod';
import { uploaderCopyOverrideSchema } from './site-settings';

const homeLink = z.string().regex(/^\/(?!\/)[^\s]*$/, 'Use a site-relative link');
const sampleSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string().min(1),
  watermark: z.string(),
  image: z.string().min(1),
});
const sectionCopy = { heading: z.string().min(1), intro: z.string().min(1) };
const comparisonStyle = z.enum(['watermark', 'date', 'signature', 'laptop']).default('watermark');
const audienceSchema = z.object({
  title: z.string().min(1),
  copy: z.string().min(1),
  cta: z.string().min(1),
  href: homeLink,
  image: z.string().min(1),
  alt: z.string(),
  tone: z.enum(['blue', 'purple', 'mint']),
});
const reviewSchema = z.object({
  quote: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  avatar: z.string().min(1),
  rating: z.number().int().min(1).max(5),
});
const toolCardSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  copy: z.string().min(1),
  href: homeLink,
  image: z.string().min(1),
  alt: z.string(),
});

const linkedCardSchema = z.object({
  icon: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  href: z.string().min(1),
  watermark: z.string().default('watermark'),
  comparisonStyle,
  cta: z.string().default('Explore tool →'),
  image: z.string().min(1),
  imageAlt: z.string().min(1),
});

const stepSchema = z.object({
  number: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  image: z.string().min(1).optional(),
  imageAlt: z.string().min(1).optional(),
});

const featureSchema = z.object({
  icon: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
});

const homepageFeatureSchema = z.object({
  enabled: z.boolean().default(true),
  eyebrow: z.string().min(1),
  heading: z.string().min(1),
  description: z.string().min(1),
  listItems: z.array(z.string().min(1)).default([]),
  image: z.string().min(1),
  imageAlt: z.string().min(1),
  imagePosition: z.enum(['left', 'right']),
  watermark: z.string().default('watermark'),
  comparisonStyle,
});

const faqItemSchema = z.object({
  enabled: z.boolean().default(true),
  question: z.string().min(1),
  answer: z.string().min(1),
});

export const homepageSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1).max(180),
  shareImage: z.string().min(1),
  uploader: uploaderCopyOverrideSchema.optional(),
  hero: z.object({
    eyebrow: z.string().min(1),
    heading: z.string().min(1),
    highlightedHeading: z.string().min(1),
    intro: z.string().min(1),
    trustItems: z.array(z.string().min(1)).min(1),
    samples: z.array(sampleSchema).min(1),
    previewNote: z.string().min(1),
    privacyNote: z.string().min(1),
  }),
  useCases: z.array(linkedCardSchema).min(1),
  audiences: z.object({ ...sectionCopy, cards: z.array(audienceSchema).min(1) }),
  testimonials: z.object({
    ...sectionCopy,
    pausedLabel: z.string().min(1),
    playLabel: z.string().min(1),
    cards: z.array(reviewSchema).min(1),
  }),
  removalTools: z.object({ ...sectionCopy, cards: z.array(toolCardSchema).min(1) }),
  useCaseSection: z.object({
    eyebrow: z.string().min(1),
    heading: z.string().min(1),
    headingHighlight: z.string().min(1),
    intro: z.string().min(1),
  }),
  process: z.object({
    eyebrow: z.string().min(1),
    heading: z.string().min(1),
    headingHighlight: z.string().min(1),
    intro: z.string().min(1),
    steps: z.array(stepSchema).min(1),
  }),
  features: z.object({
    eyebrow: z.string().min(1),
    heading: z.string().min(1),
    headingHighlight: z.string().min(1),
    intro: z.string().min(1),
    items: z.array(homepageFeatureSchema).min(1),
  }),
  privacy: z.object({
    eyebrow: z.string().min(1),
    heading: z.string().min(1),
    headingHighlight: z.string().min(1),
    description: z.string().min(1),
    linkLabel: z.string().min(1),
    linkHref: z.string().min(1),
    features: z.array(featureSchema).length(4),
  }),
  guides: z.object({
    eyebrow: z.string().min(1),
    heading: z.string().min(1),
    headingHighlight: z.string().min(1),
    intro: z.string().min(1),
    linkLabel: z.string().min(1),
    linkHref: z.string().min(1),
    articleLinkLabel: z.string().min(1),
  }),
  faq: z.object({
    eyebrow: z.string().min(1),
    heading: z.string().min(1),
    headingHighlight: z.string().min(1),
    intro: z.string().min(1),
    items: z.array(faqItemSchema).min(1),
  }),
});

export type Homepage = z.infer<typeof homepageSchema>;
