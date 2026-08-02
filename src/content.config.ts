import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'zod';
import { publishedAtSchema } from './lib/content/published-date';

const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: z.string().min(1),
    description: z.string().min(1),
    publishedAt: publishedAtSchema,
    readTime: z.string().min(1),
  }),
});

const faqItem = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
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
    faq: z.array(faqItem).min(1),
  }),
});

export const collections = { blog, landingPages };
