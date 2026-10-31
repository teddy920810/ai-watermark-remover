import { z } from 'zod';
import { cloudRunTriggerFromEnvironment } from '../runtime/cloud-run-trigger';
import { getImageCreditPrices } from './image-credit-prices';

const purchase = z.object({
  sku: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().min(1).max(80),
  credits: z.number().int().min(1).max(100_000),
  amountCents: z.number().int().min(100).max(1_000_000),
  currency: z.literal('USD'),
});
export type PaymentPackage = z.infer<typeof purchase>;
export const sandboxPackages: PaymentPackage[] = [
  { sku: 'starter', name: 'Starter', credits: 5, amountCents: 499, currency: 'USD' },
  { sku: 'regular', name: 'Regular', credits: 15, amountCents: 999, currency: 'USD' },
  { sku: 'batch', name: 'Batch', credits: 40, amountCents: 1999, currency: 'USD' },
];

// Live prices require an explicit approved catalog; sandbox examples never silently become live prices.
export function getPaymentConfig(source: NodeJS.ProcessEnv = process.env) {
  const enabled = source.PAYPAL_ENABLED === 'true';
  const creditsEnabled = source.PAYPAL_CREDITS_ENABLED === undefined ? enabled : source.PAYPAL_CREDITS_ENABLED === 'true';
  const environment = z.enum(['sandbox', 'live']).parse(source.PAYPAL_ENVIRONMENT ?? 'sandbox');
  const clientId = source.PAYPAL_CLIENT_ID ?? '';
  const clientSecret = source.PAYPAL_CLIENT_SECRET ?? '';
  const merchantId = source.PAYPAL_MERCHANT_ID ?? '';
  const webhookId = source.PAYPAL_WEBHOOK_ID ?? '';
  if (enabled && (!creditsEnabled || !clientId || !clientSecret || !merchantId || !webhookId)) throw new Error('PayPal configuration is incomplete');
  if (enabled && environment === 'live' && (source.PAYPAL_LIVE_APPROVED !== 'true' || !source.PAYPAL_CATALOG_JSON || !source.PAYPAL_CATALOG_VERSION)) throw new Error('Live checkout requires approved prices, catalog version and release readiness');
  if (enabled && environment === 'live' && (source.WATERMARK_PROVIDER !== 'dewatermark' || !source.DEWATERMARK_API_KEY || !source.REPLICATE_API_TOKEN || (source.BACKGROUND_REMOVAL_PROVIDER ?? 'replicate') !== 'replicate' || (source.OBJECT_REMOVAL_PROVIDER ?? 'replicate') !== 'replicate')) throw new Error('Live checkout requires real processing providers');
  if (enabled && environment === 'live') {
    if (source.PROCESSING_ENABLED !== 'true' || source.PROCESSING_PROVIDER !== 'dewatermark') throw new Error('Live checkout requires real normal-image processing');
    // The normal-image workspace uses the durable Worker path. Reuse its exact
    // configuration parser; constructing a trigger never starts work or obtains a token.
    // Deployed Worker compatibility and real IAM still require release acceptance.
    try {
      if (!cloudRunTriggerFromEnvironment(source)) throw new Error();
    } catch { throw new Error('Live checkout requires durable processing dispatch'); }
  }
  const packages = source.PAYPAL_CATALOG_JSON ? z.array(purchase).min(1).max(6).parse(JSON.parse(source.PAYPAL_CATALOG_JSON)) : sandboxPackages;
  if (new Set(packages.map((item) => item.sku)).size !== packages.length) throw new Error('Duplicate payment SKU');
  const imagePrices = getImageCreditPrices(source);
  const catalogVersion = z.string().regex(/^[a-zA-Z0-9:_-]{1,100}$/).parse(source.PAYPAL_CATALOG_VERSION ?? 'sandbox-image-credits-v1');
  return { enabled, creditsEnabled, environment, clientId, clientSecret, merchantId, webhookId, packages, catalogVersion, imageCosts: imagePrices.costs, imageCostVersion: imagePrices.version };
}
export type PaymentConfig = ReturnType<typeof getPaymentConfig>;

// Explicit projection shared by the API and the request-rendered pricing page.
// Never pass the server configuration object to an island: it contains credentials.
export function publicPaymentCatalog(config: PaymentConfig) {
  return {
    enabled: config.enabled, creditsEnabled: config.creditsEnabled, environment: config.environment,
    ...(config.enabled ? { clientId: config.clientId } : {}),
    packages: config.packages, imageCosts: config.imageCosts, imageCostVersion: config.imageCostVersion,
  };
}
