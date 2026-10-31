import type { APIRoute } from 'astro';
import { z } from 'zod';
import { buyer, boundedJson, orderId, paymentResponse } from '../../../../lib/payments/http';
import { getPaymentService } from '../../../../lib/payments/payment-services';
import { publicOrder } from '../../../../lib/payments/payment-service';
export const prerender = false;
export const POST: APIRoute = ({ request }) => paymentResponse(async () => {
  const userId = await buyer(request, true);
  const { sku } = z.object({ sku: z.string().regex(/^[a-z0-9-]{1,40}$/) }).strict().parse(await boundedJson(request));
  const key = orderId(request.headers.get('Idempotency-Key') ?? undefined);
  return publicOrder(await getPaymentService().create(userId, sku, key));
}, 201);
