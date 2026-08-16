import { z } from 'zod';

const stepSchema = z.object({
  number: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
});

export const blogIndexSettingsSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1).max(180),
  shareImage: z.string().min(1),
  eyebrow: z.string().min(1),
  heading: z.string().min(1),
  intro: z.string().min(1),
  postsPerPage: z.number().int().min(1).max(100),
});

export const landingCommonSettingsSchema = z.object({
  process: z.object({
    eyebrow: z.string().min(1),
    heading: z.string().min(1),
    steps: z.array(stepSchema).min(1),
  }),
  faq: z.object({
    eyebrow: z.string().min(1),
    heading: z.string().min(1),
  }),
});

export const notFoundSettingsSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1).max(180),
  eyebrow: z.string().min(1),
  heading: z.string().min(1),
  intro: z.string().min(1),
  buttonLabel: z.string().min(1),
  buttonHref: z.string().min(1),
});

export const legalPageSchema = z.object({
  slug: z.enum(['privacy', 'terms']),
  title: z.string().min(1),
  description: z.string().min(1).max(180),
  eyebrow: z.string().min(1),
  heading: z.string().min(1),
});
