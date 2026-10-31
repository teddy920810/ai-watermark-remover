import type { PaymentConfig } from './payment-config';
import type { PaymentOrder, PaymentStore } from './payment-store';
import { cents, PayPalIssueError, type PayPalGateway, type PayPalOrder } from './paypal-client';

export class PaymentError extends Error {
  constructor(message: string, readonly status = 503, readonly code?: string) { super(message); }
}
export class PaymentService {
  constructor(private readonly config: PaymentConfig, private readonly store: PaymentStore, private readonly paypal: PayPalGateway) {}
  catalog() {
    return { enabled: this.config.enabled, creditsEnabled: this.config.creditsEnabled, environment: this.config.environment, ...(this.config.enabled ? { clientId: this.config.clientId } : {}), packages: this.config.packages, imageCosts: this.config.imageCosts, imageCostVersion: this.config.imageCostVersion };
  }
  async create(userId: string, sku: string, requestKey: string) {
    if (!this.config.enabled) throw new PaymentError('Checkout is not available.', 503);
    const item = this.config.packages.find((entry) => entry.sku === sku);
    if (!item) throw new PaymentError('Unknown package.', 400);
    const order = await this.store.createOrder(userId, { sku, credits: item.credits, amountCents: item.amountCents, currency: item.currency, catalogVersion: this.config.catalogVersion }, requestKey);
    if (order.paypalOrderId || order.status !== 'created') return order;
    const remote = await this.paypal.createOrder(order);
    if (!/^[A-Z0-9]{1,36}$/.test(remote.id) || !['CREATED', 'PAYER_ACTION_REQUIRED'].includes(remote.status)) throw new PaymentError('Unable to start checkout.');
    return this.store.attachPaypalOrder(order.id, remote.id);
  }
  async list(userId: string) { return this.store.listOrders(userId); }
  private async owned(userId: string, id: string) {
    const order = await this.store.getOrder(id);
    if (!order || order.userId !== userId) throw new PaymentError('Order not found.', 404);
    return order;
  }
  async capture(userId: string, id: string) {
    const order = await this.owned(userId, id);
    if (!order.paypalOrderId) throw new PaymentError('Payment is still being confirmed.', 409);
    if (order.status !== 'created') return order;
    // Capture and GET recovery refer to the same persisted order; no second checkout is created on a timeout.
    try { await this.paypal.captureOrder(order.paypalOrderId, order.id); }
    catch (error) { if (error instanceof PayPalIssueError) throw new PaymentError('Choose another payment method or approve the order in PayPal.', 422, error.issue); }
    return this.sync(order);
  }
  async refresh(userId: string, id: string) {
    const order = await this.owned(userId, id);
    return order.paypalOrderId && (order.status === 'created' || order.status === 'fulfilled') ? this.sync(order) : order;
  }
  private async sync(order: PaymentOrder): Promise<PaymentOrder> {
    const remote = await this.paypal.getOrder(order.paypalOrderId!);
    return this.confirm(order, remote);
  }
  private async confirm(order: PaymentOrder, remote: PayPalOrder): Promise<PaymentOrder> {
    const units = remote.purchase_units;
    const unit = units?.[0];
    const captures = unit?.payments?.captures ?? [];
    if (remote.id !== order.paypalOrderId || !unit || units!.length !== 1 || unit.reference_id !== order.id || unit.custom_id !== order.id || unit.invoice_id !== order.id || unit.payee?.merchant_id !== this.config.merchantId || unit.amount.currency_code !== order.currency || cents(unit.amount.value) !== order.amountCents || captures.length > 1) throw new PaymentError('Payment details do not match.', 409);
    const capture = captures[0];
    if (!capture || remote.status !== 'COMPLETED') return order;
    if (capture.amount.currency_code !== order.currency || cents(capture.amount.value) !== order.amountCents) throw new PaymentError('Payment details do not match.', 409);
    if (['REFUNDED', 'PARTIALLY_REFUNDED', 'REVERSED'].includes(capture.status)) {
      await this.store.applyAdjustment(`capture-state:${capture.id}:${capture.status}`, capture.id, 'reversal', 0);
      return this.store.fulfill(order.id, { id: capture.id, paypalOrderId: remote.id, amountCents: order.amountCents, currency: order.currency, merchantId: this.config.merchantId });
    }
    if (capture.status !== 'COMPLETED') return order;
    // The store atomically deduplicates capture, financial ledger, credit lot and order fulfillment.
    return this.store.fulfill(order.id, { id: capture.id, paypalOrderId: remote.id, amountCents: order.amountCents, currency: order.currency, merchantId: this.config.merchantId });
  }
  async webhook(headers: Headers, input: unknown) {
    if (!await this.paypal.verifyWebhook(headers, input)) throw new PaymentError('Invalid webhook signature.', 400);
    if (!input || typeof input !== 'object') throw new PaymentError('Invalid webhook event.', 400);
    const event = input as { id?: unknown; event_type?: unknown; resource?: Record<string, unknown> };
    if (typeof event.id !== 'string' || event.id.length > 100 || typeof event.event_type !== 'string' || !event.resource) throw new PaymentError('Invalid webhook event.', 400);
    const resource = event.resource;
    const resourceId = typeof resource.id === 'string' ? resource.id : '';
    if (!await this.store.recordEvent({ id: event.id, eventType: event.event_type, resourceId, payload: { resourceId } })) return;
    if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED' || event.event_type === 'CHECKOUT.ORDER.APPROVED') {
      const remoteId = event.event_type === 'CHECKOUT.ORDER.APPROVED' ? resourceId : (await this.paypal.getCapture(resourceId)).supplementary_data?.related_ids?.order_id;
      const order = remoteId ? await this.store.getOrderByPaypalId(remoteId) : null;
      if (order?.paypalOrderId && order.status === 'created') {
        // Buyer approval still requires server-side capture; capture completion is always verified by GET.
        const updated = event.event_type === 'CHECKOUT.ORDER.APPROVED' ? await this.capture(order.userId, order.id) : await this.sync(order);
        if (updated.status === 'created') throw new PaymentError('Payment is still being confirmed.');
      }
    } else if (event.event_type === 'PAYMENT.CAPTURE.REFUNDED') {
      const refund = await this.paypal.getRefund(resourceId);
      if (refund.status === 'COMPLETED') {
        const up = refund.links?.find((link) => link.rel === 'up')?.href;
        let captureId: string | undefined;
        if (up) {
          const url = new URL(up);
          if (url.protocol === 'https:' && /(^|\.)paypal\.com$/.test(url.hostname)) captureId = /^\/v2\/payments\/captures\/([A-Z0-9]+)$/.exec(url.pathname)?.[1];
        }
        if (!captureId || refund.amount.currency_code !== 'USD') throw new PaymentError('Refund requires review.');
        await this.store.applyAdjustment(`refund:${refund.id}`, captureId, 'refund', cents(refund.amount.value));
      } else if (refund.status !== 'CANCELLED' && refund.status !== 'FAILED') throw new PaymentError('Refund is still being confirmed.');
    } else if (event.event_type === 'PAYMENT.CAPTURE.REVERSED') {
      await this.store.applyAdjustment(`reversal:${resourceId}`, resourceId, 'reversal', 0);
    } else if (event.event_type === 'CUSTOMER.DISPUTE.CREATED') {
      const transactions = resource.disputed_transactions as { seller_transaction_id?: string }[] | undefined;
      for (const transaction of transactions ?? []) {
        if (transaction.seller_transaction_id) await this.store.applyAdjustment(`dispute:${resourceId}:${transaction.seller_transaction_id}`, transaction.seller_transaction_id, 'dispute', 0);
      }
    }
    // Any failure before this point leaves the durable inbox uncompleted and returns non-2xx for PayPal retry.
    await this.store.completeEvent(event.id);
  }
}

// Client responses intentionally exclude internal identities and idempotency keys.
export function publicOrder(order: PaymentOrder) {
  return { id: order.id, sku: order.sku, credits: order.credits, amountCents: order.amountCents, currency: order.currency, paypalOrderId: order.paypalOrderId, status: order.status, createdAt: order.createdAt };
}
