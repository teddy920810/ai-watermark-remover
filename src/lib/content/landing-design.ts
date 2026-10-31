import { z } from 'zod';

export const landingComparisonSchema = z.object({
  image: z.string().min(1).optional(),
  beforeImage: z.string().min(1).optional(),
  watermark: z.string().min(1).optional(),
  style: z.enum(['gemini', 'watermark']).optional(),
}).refine(comparison => Boolean(comparison.beforeImage || comparison.watermark || comparison.style), {
  message: 'Choose an original image or an illustrative watermark treatment.',
});

const landingHeroSampleSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  label: z.string().min(1),
  image: z.string().min(1),
  imageAlt: z.string().min(1),
  comparison: landingComparisonSchema.optional(),
});

const relatedContentSchema = z.object({
  enabled: z.boolean().default(true),
  eyebrow: z.string().min(1),
  heading: z.string().min(1),
  intro: z.string().min(1),
  slugs: z.preprocess(
    value => Array.isArray(value) && value.length === 0 ? undefined : value,
    z.array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)).min(1).optional(),
  ).optional(),
});

export const landingDesignFields = {
  heroSamples: z.array(landingHeroSampleSchema).min(1).max(6).refine(
    samples => new Set(samples.map(sample => sample.id)).size === samples.length,
    { message: 'Hero sample identifiers must be unique within this page.' },
  ).optional(),
  relatedTools: relatedContentSchema.optional(),
  guides: relatedContentSchema.optional(),
};

export type LandingComparison = z.infer<typeof landingComparisonSchema>;

interface RelatedToolEntry {
  data: { slug: string; draft?: boolean; statusLabel?: string };
}

export function availableRelatedToolEntries<T extends RelatedToolEntry>(entries: readonly T[], slugs?: readonly string[]): T[] {
  const available = entries.filter(entry => !entry.data.draft && !entry.data.statusLabel);
  if (!slugs) return available;
  const bySlug = new Map(available.map(entry => [entry.data.slug, entry]));
  return slugs.flatMap(slug => {
    const entry = bySlug.get(slug);
    return entry ? [entry] : [];
  });
}
