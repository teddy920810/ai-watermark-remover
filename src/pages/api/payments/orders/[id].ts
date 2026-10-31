import type { APIRoute } from 'astro';
import { buyer, orderId, paymentResponse } from '../../../../lib/payments/http';
import { getPaymentService } from '../../../../lib/payments/payment-services';
import { publicOrder } from '../../../../lib/payments/payment-service';
export const prerender = false;
export const GET: APIRoute = ({ request, params }) => paymentResponse(async () => {
  const userId = await buyer(request);
  return publicOrder(await getPaymentService().refresh(userId, orderId(params.id)));
});
