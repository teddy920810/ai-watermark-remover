import { z } from 'zod';

export const imagePairFields = {
  image: z.string().trim().min(1).optional(),
  afterImage: z.preprocess(value => typeof value === 'string' && !value.trim() ? undefined : value, z.string().trim().min(1).optional()),
};
export function validateImagePair(value: { image?: string; afterImage?: string }, context: z.RefinementCtx) {
  if (value.afterImage && (!value.image || value.afterImage === value.image)) {
    context.addIssue({ code: 'custom', path: ['afterImage'], message: 'After requires a different Before image.' });
  }
}
export const imagePairSchema = z.object(imagePairFields).strict().superRefine(validateImagePair);

/** Read-only compatibility for old content; illustrative overlays become a static image. */
export function resolveImagePair(value: { image?: string; afterImage?: string; comparison?: { image?: string; beforeImage?: string; [key: string]: unknown } }) {
  if (value.afterImage) return { image: value.image || value.comparison?.image, afterImage: value.afterImage };
  const legacyAfter = value.comparison?.image || value.image;
  if (legacyAfter && value.comparison?.beforeImage && value.comparison.beforeImage !== legacyAfter) return { image: value.comparison.beforeImage, afterImage: legacyAfter };
  const image = value.image || value.comparison?.image;
  return image ? { image } : {};
}
