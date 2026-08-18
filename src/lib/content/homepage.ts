import { z } from 'zod';

const linkedCardSchema = z.object({
  icon: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  href: z.string().min(1),
});

const stepSchema = z.object({
  number: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
});

const featureSchema = z.object({
  icon: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
});

const homepageFeatureSchema = z.object({
  eyebrow: z.string().min(1),
  heading: z.string().min(1),
  description: z.string().min(1),
  listItems: z.array(z.string().min(1)).default([]),
  image: z.string().min(1),
  imageAlt: z.string().min(1),
  imagePosition: z.enum(['left', 'right']),
});

const faqItemSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
});

export const homepageSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1).max(180),
  shareImage: z.string().min(1),
  hero: z.object({
    eyebrow: z.string().min(1),
    heading: z.string().min(1),
    highlightedHeading: z.string().min(1),
    intro: z.string().min(1),
    trustItems: z.array(z.string().min(1)).min(1),
  }),
  useCases: z.array(linkedCardSchema).min(1),
  process: z.object({
    eyebrow: z.string().min(1),
    heading: z.string().min(1),
    intro: z.string().min(1),
    steps: z.array(stepSchema).min(1),
  }),
  features: z.object({
    eyebrow: z.string().min(1),
    heading: z.string().min(1),
    intro: z.string().min(1),
    items: z.array(homepageFeatureSchema).min(1),
  }),
  privacy: z.object({
    eyebrow: z.string().min(1),
    heading: z.string().min(1),
    description: z.string().min(1),
    linkLabel: z.string().min(1),
    linkHref: z.string().min(1),
    features: z.array(featureSchema).min(1),
  }),
  guides: z.object({
    eyebrow: z.string().min(1),
    heading: z.string().min(1),
    linkLabel: z.string().min(1),
    linkHref: z.string().min(1),
    articleLinkLabel: z.string().min(1),
  }),
  faq: z.object({
    eyebrow: z.string().min(1),
    heading: z.string().min(1),
    intro: z.string().min(1),
    items: z.array(faqItemSchema).min(1),
  }),
});

export type Homepage = z.infer<typeof homepageSchema>;
