import type { APIRoute } from 'astro';
import { z } from 'zod';
import { buyer, boundedJson, orderId, paymentResponse } from '../../../../../../lib/payments/http';
import { getPaymentService } from '../../../../../../lib/payments/payment-services';
import { publicOrder } from '../../../../../../lib/payments/payment-service';
export const prerender = false;
export const POST: APIRoute = ({ request, params }) => paymentResponse(async () => {
  const userId = await buyer(request, true);
  const id = orderId(params.id);
  z.object({}).strict().parse(await boundedJson(request));
  return publicOrder(await getPaymentService().capture(userId, id));
});
