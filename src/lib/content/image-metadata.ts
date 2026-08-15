import { z } from 'zod';

const imageMetadataSchema = z.object({
  src: z.string().startsWith('/'),
  alt: z.string().min(1),
  title: z.string().min(1).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

export const imageSettingsSchema = z.object({
  images: z.array(imageMetadataSchema),
}).superRefine(({ images }, context) => {
  const seen = new Set<string>();
  images.forEach((image, index) => {
    if (seen.has(image.src)) {
      context.addIssue({ code: 'custom', path: ['images', index, 'src'], message: 'Image paths must be unique.' });
    }
    seen.add(image.src);
  });
});

export type ManagedImage = z.infer<typeof imageMetadataSchema>;

export function resolveImageAlt(
  src: string,
  override: string | undefined,
  images: ManagedImage[],
  fallback: string,
) {
  return override ?? images.find((image) => image.src === src)?.alt ?? fallback;
}
