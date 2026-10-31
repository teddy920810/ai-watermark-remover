import { z } from 'zod';

const cost = z.number().int().min(1).max(1_000_000);
const costsSchema = z.object({
  'watermark-removal': cost,
  'background-removal': cost,
  'object-removal': cost,
}).strict();
export type ImageCreditCosts = z.infer<typeof costsSchema>;
const sandboxCosts: ImageCreditCosts = { 'watermark-removal': 1, 'background-removal': 1, 'object-removal': 1 };
const versionSchema = z.string().regex(/^[a-zA-Z0-9:_-]{1,100}$/);

/** Pure configuration only: operation prices never initialize media, accounts or Providers. */
export function getImageCreditPrices(source: Record<string, string | undefined> = process.env): { costs: ImageCreditCosts; version: string } {
  const environment = z.enum(['sandbox', 'live']).parse(source.PAYPAL_ENVIRONMENT ?? 'sandbox');
  const enabled = (source.PAYPAL_CREDITS_ENABLED ?? source.PAYPAL_ENABLED) === 'true';
  if (environment === 'live' && enabled && (!source.PAYPAL_IMAGE_COSTS_JSON || !source.PAYPAL_IMAGE_COST_VERSION)) {
    throw new Error('Live image credits require explicit operation costs and version');
  }
  const costs = source.PAYPAL_IMAGE_COSTS_JSON ? costsSchema.parse(JSON.parse(source.PAYPAL_IMAGE_COSTS_JSON)) : { ...sandboxCosts };
  const version = versionSchema.parse(source.PAYPAL_IMAGE_COST_VERSION ?? 'sandbox-image-costs-v1');
  return { costs, version };
}
