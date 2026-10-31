import type { APIRoute } from 'astro';
import { getPaymentConfig, publicPaymentCatalog } from '../../../lib/payments/payment-config';
import { paymentResponse } from '../../../lib/payments/http';
export const prerender = false;
export const GET: APIRoute = () => paymentResponse(async () => {
  const config = getPaymentConfig();
  return publicPaymentCatalog(config);
});
