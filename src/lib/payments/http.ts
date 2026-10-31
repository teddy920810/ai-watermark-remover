import { z } from 'zod';
import { getSession } from '../auth';
import { json } from '../api/response';
import { PaymentError } from './payment-service';

export async function buyer(request: Request, mutate = false): Promise<string> {
  const session = await getSession(request);
  if (!session?.user.id) throw new PaymentError('Sign in with Google to manage payments.', 401);
  if (mutate && (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site')) throw new PaymentError('Request origin is not allowed.', 403);
  return session.user.id;
}
export function orderId(id?: string) {
  if (!id || !z.uuid().safeParse(id).success) throw new PaymentError('Invalid order ID.', 400);
  return id;
}
export async function boundedJson(request: Request, maxBytes = 4096): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new PaymentError('Expected JSON request.', 400);
  const reader = request.body?.getReader();
  if (!reader) throw new PaymentError('Invalid JSON request.', 400);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > maxBytes) { await reader.cancel(); throw new PaymentError('Request is too large.', 413); } chunks.push(value); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) { if (error instanceof PaymentError) throw error; throw new PaymentError('Invalid JSON request.', 400); }
}
export async function paymentResponse(work: () => Promise<unknown>, status = 200) {
  try { return json(await work(), { status }); }
  catch (error) {
    if (error instanceof PaymentError) return json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, { status: error.status });
    if (error instanceof z.ZodError) return json({ error: 'Invalid payment request.' }, { status: 400 });
    // Database/provider messages may contain identifiers or configuration; never return them.
    return json({ error: 'Payment is temporarily unavailable. Check your order before paying again.' }, { status: 503 });
  }
}
