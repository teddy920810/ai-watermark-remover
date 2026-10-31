import type { APIRoute } from 'astro';
import { getPaymentConfig } from '../../../lib/payments/payment-config';
import { paymentResponse } from '../../../lib/payments/http';
export const prerender = false;
export const GET: APIRoute = () => paymentResponse(async () => {
  const config = getPaymentConfig();
  return { enabled: config.enabled, creditsEnabled: config.creditsEnabled, environment: config.environment, ...(config.enabled ? { clientId: config.clientId } : {}), packages: config.packages, imageCosts: config.imageCosts, imageCostVersion: config.imageCostVersion };
});
