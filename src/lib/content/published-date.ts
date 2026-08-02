import { z } from 'zod';

const canonicalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const publishedAtSchema = z
  .union([canonicalDate, z.date()])
  .transform((value) => (value instanceof Date ? value.toISOString().slice(0, 10) : value));
