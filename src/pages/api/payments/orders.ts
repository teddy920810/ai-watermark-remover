import type { APIRoute } from 'astro';
import { buyer, paymentResponse } from '../../../lib/payments/http';
import { getPaymentService } from '../../../lib/payments/payment-services';
import { publicOrder } from '../../../lib/payments/payment-service';
export const prerender = false;
export const GET: APIRoute = ({ request }) => paymentResponse(async () => {
  const userId = await buyer(request);
  return { orders: (await getPaymentService().list(userId)).map(publicOrder) };
});
