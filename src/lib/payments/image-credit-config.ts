import { z } from 'zod';
import { getImageCreditPrices } from './image-credit-prices';

/** Shared non-secret wallet settings for both Web and Worker. */
export function imageCreditConfigFromEnvironment(source: Record<string, string | undefined>) {
  const prices = getImageCreditPrices(source);
  return {
    enabled: (source.PAYPAL_CREDITS_ENABLED ?? source.PAYPAL_ENABLED) === 'true',
    environment: z.enum(['sandbox', 'live']).parse(source.PAYPAL_ENVIRONMENT ?? 'sandbox'),
    costs: prices.costs,
    priceVersion: prices.version,
  };
}
