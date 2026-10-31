import type { APIRoute } from 'astro';
import { boundedJson, paymentResponse } from '../../../../lib/payments/http';
import { getPaymentService } from '../../../../lib/payments/payment-services';
export const prerender = false;
export const POST: APIRoute = ({ request }) => paymentResponse(async () => {
  const event = await boundedJson(request, 262_144);
  await getPaymentService().webhook(request.headers, event);
  return { received: true };
});
