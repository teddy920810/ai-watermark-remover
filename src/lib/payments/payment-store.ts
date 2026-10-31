export interface PaymentPurchase {
  sku: string;
  credits: number;
  amountCents: number;
  currency: 'USD';
  catalogVersion: string;
}

export type PaymentOrderStatus = 'created' | 'fulfilled' | 'review' | 'refunded';

export interface PaymentOrder extends PaymentPurchase {
  environment: 'sandbox' | 'live';
  id: string;
  userId: string;
  requestKey: string;
  paypalOrderId: string | null;
  captureId: string | null;
  status: PaymentOrderStatus;
  createdAt: string;
}

export interface PaymentCapture {
  id: string;
  paypalOrderId: string;
  amountCents: number;
  currency: 'USD';
  merchantId: string;
}

export interface PaymentEvent {
  id: string;
  eventType: string;
  resourceId: string;
  /** Only retain the minimum reconciliation identifiers, never credentials or payer details. */
  payload: Record<string, unknown>;
}

export type PaymentAdjustmentReason = 'refund' | 'reversal' | 'dispute';

export interface PaymentStore {
  createOrder(userId: string, purchase: PaymentPurchase, requestKey: string): Promise<PaymentOrder>;
  attachPaypalOrder(id: string, paypalOrderId: string): Promise<PaymentOrder>;
  getOrder(id: string): Promise<PaymentOrder | null>;
  getOrderByPaypalId(id: string): Promise<PaymentOrder | null>;
  getOrderByCaptureId(id: string): Promise<PaymentOrder | null>;
  listOrders(userId: string): Promise<PaymentOrder[]>;
  fulfill(orderId: string, capture: PaymentCapture): Promise<PaymentOrder>;
  /** Returns false only after the same event has completed; interrupted events are retryable. */
  recordEvent(event: PaymentEvent): Promise<boolean>;
  completeEvent(id: string): Promise<void>;
  /** Freezes the affected purchase. Partly consumed/refunded purchases require manual review. */
  applyAdjustment(refId: string, captureId: string, reason: PaymentAdjustmentReason, amountCents: number): Promise<void>;
}
