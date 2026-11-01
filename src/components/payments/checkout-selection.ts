import { safeReturnPath } from './payment-client';
import type { PaymentAttempt } from './payment-attempt';

/** URL values only select a public SKU. The server always owns price and order authorization. */
export function selectCheckoutSku(packages: ReadonlyArray<{ sku: string }>, requested: string | null | undefined, active?: PaymentAttempt | null): string {
  if (active) return active.sku;
  return packages.some(item => item.sku === requested) ? requested! : packages[0]?.sku ?? '';
}
export function checkoutPath(sku: string, returnTo: string | null = null): string {
  return `/app/credits?sku=${encodeURIComponent(sku)}&returnTo=${encodeURIComponent(safeReturnPath(returnTo))}`;
}
