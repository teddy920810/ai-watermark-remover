import type { PaymentOrder } from './payment-client';

export interface PaymentAttempt {
  sku: string;
  requestKey: string;
  orderId?: string;
}

export function paymentAccountId(user: { id: string; watermarkAccountId?: unknown } | null | undefined): string | null {
  // The installed auth flow already resolves the canonical account ID. This ID
  // scopes browser recovery only; the server authorizes every order independently.
  return typeof user?.id === 'string' && user.id.trim() ? user.id : null;
}

export function parsePaymentAttempt(value: string | null): PaymentAttempt | null {
  if (!value) return null;
  try {
    const item = JSON.parse(value) as Partial<PaymentAttempt> | null;
    if (!item || typeof item.sku !== 'string' || !item.sku || typeof item.requestKey !== 'string' || !item.requestKey || (item.orderId !== undefined && (typeof item.orderId !== 'string' || !item.orderId))) return null;
    return { sku: item.sku, requestKey: item.requestKey, ...(item.orderId ? { orderId: item.orderId } : {}) };
  } catch { return null; }
}

export function canResolveAttempt(attempt: PaymentAttempt | null, order: Pick<PaymentOrder, 'id' | 'sku' | 'status'>, requestKey?: string): boolean {
  return Boolean(attempt?.orderId && attempt.orderId === order.id && attempt.sku === order.sku && (!requestKey || requestKey === attempt.requestKey) && ['fulfilled', 'refunded', 'review', 'reversed', 'disputed'].includes(order.status));
}
