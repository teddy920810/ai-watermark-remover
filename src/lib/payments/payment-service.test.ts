import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentService } from './payment-service';
import { getPaymentConfig } from './payment-config';
import { PayPalIssueError } from './paypal-client';

const config = getPaymentConfig({ PAYPAL_ENABLED: 'true', PAYPAL_CLIENT_ID: 'public', PAYPAL_CLIENT_SECRET: 'private', PAYPAL_MERCHANT_ID: 'MERCHANT1', PAYPAL_WEBHOOK_ID: 'WH1' });
const order = { environment: 'sandbox' as const, captureId: null, id: 'local-1', userId: 'user-1', sku: 'starter', credits: 5, amountCents: 499, currency: 'USD' as const, catalogVersion: 'v1', requestKey: 'request-key', paypalOrderId: 'PPORDER1', status: 'created' as const, createdAt: new Date().toISOString() };
const remote = () => ({ id: 'PPORDER1', status: 'COMPLETED', purchase_units: [{ reference_id: 'local-1', custom_id: 'local-1', invoice_id: 'local-1', payee: { merchant_id: 'MERCHANT1' }, amount: { currency_code: 'USD', value: '4.99' }, payments: { captures: [{ id: 'CAPTURE1', status: 'COMPLETED', amount: { currency_code: 'USD', value: '4.99' } }] } }] });
function setup() {
  const store = { createOrder: vi.fn().mockResolvedValue(order), attachPaypalOrder: vi.fn().mockResolvedValue(order), getOrder: vi.fn().mockResolvedValue(order), listOrders: vi.fn().mockResolvedValue([order]), fulfill: vi.fn().mockResolvedValue({ ...order, status: 'fulfilled' }), recordEvent: vi.fn().mockResolvedValue(true), completeEvent: vi.fn(), getOrderByPaypalId: vi.fn().mockResolvedValue(order), getOrderByCaptureId: vi.fn().mockResolvedValue(order), applyAdjustment: vi.fn() };
  const gateway = { createOrder: vi.fn().mockResolvedValue({ id: 'PPORDER1', status: 'CREATED' }), captureOrder: vi.fn().mockResolvedValue(remote()), getOrder: vi.fn().mockResolvedValue(remote()), verifyWebhook: vi.fn().mockResolvedValue(true), getCapture: vi.fn().mockResolvedValue({ id: 'CAPTURE1', status: 'COMPLETED', supplementary_data: { related_ids: { order_id: 'PPORDER1' } } }), getRefund: vi.fn() };
  return { store, gateway, service: new PaymentService(config, store, gateway) };
}
describe('payment fulfillment', () => {
  beforeEach(() => vi.clearAllMocks());
  it('never exposes secret config and refuses disabled checkout or unknown SKUs before calling PayPal', async () => {
    const { service, gateway, store } = setup();
    expect(JSON.stringify(service.catalog())).not.toContain('private');
    await expect(service.create('user-1', 'tampered', 'key')).rejects.toThrow('Unknown package');
    expect(store.createOrder).not.toHaveBeenCalled();
    await expect(new PaymentService({ ...config, enabled: false }, store, gateway).create('user-1', 'starter', 'key')).rejects.toThrow('Checkout is not available');
  });
  it('snapshots server prices and recovers the existing order without creating a new payment', async () => {
    const { service, gateway, store } = setup();
    await service.create('user-1', 'starter', 'key');
    expect(store.createOrder).toHaveBeenCalledWith('user-1', expect.objectContaining({ amountCents: 499, credits: 5 }), 'key');
    expect(gateway.createOrder).not.toHaveBeenCalled();
  });
  // PayPal Wallet create responses can require buyer action before approval:
  // https://developer.paypal.com/api/orders/v2/orders-create
  it.each(['CREATED', 'PAYER_ACTION_REQUIRED'])('attaches a newly created %s PayPal order without capturing or issuing credits', async (status) => {
    const { service, gateway, store } = setup();
    store.createOrder.mockResolvedValue({ ...order, paypalOrderId: null });
    gateway.createOrder.mockResolvedValue({ id: 'PPORDER1', status });

    await expect(service.create('user-1', 'starter', 'key')).resolves.toEqual(order);

    expect(gateway.createOrder).toHaveBeenCalledTimes(1);
    expect(store.attachPaypalOrder).toHaveBeenCalledWith('local-1', 'PPORDER1');
    expect(gateway.captureOrder).not.toHaveBeenCalled();
    expect(store.fulfill).not.toHaveBeenCalled();
  });
  it.each(['APPROVED', 'COMPLETED', 'VOIDED', 'UNKNOWN'])('does not attach an unexpected %s create response', async (status) => {
    const { service, gateway, store } = setup();
    store.createOrder.mockResolvedValue({ ...order, paypalOrderId: null });
    gateway.createOrder.mockResolvedValue({ id: 'PPORDER1', status });

    await expect(service.create('user-1', 'starter', 'key')).rejects.toThrow('Unable to start checkout.');

    expect(store.attachPaypalOrder).not.toHaveBeenCalled();
    expect(store.fulfill).not.toHaveBeenCalled();
  });
  it.each(['', 'invalid/order'])('does not attach a buyer-action order with invalid PayPal id %j', async (id) => {
    const { service, gateway, store } = setup();
    store.createOrder.mockResolvedValue({ ...order, paypalOrderId: null });
    gateway.createOrder.mockResolvedValue({ id, status: 'PAYER_ACTION_REQUIRED' });

    await expect(service.create('user-1', 'starter', 'key')).rejects.toThrow('Unable to start checkout.');

    expect(store.attachPaypalOrder).not.toHaveBeenCalled();
    expect(store.fulfill).not.toHaveBeenCalled();
  });
  it('checks owner before contacting PayPal and accepts only a verified matching completed capture', async () => {
    const { service, gateway, store } = setup();
    await expect(service.capture('attacker', 'local-1')).rejects.toThrow('Order not found');
    expect(gateway.captureOrder).not.toHaveBeenCalled();
    expect((await service.capture('user-1', 'local-1')).status).toBe('fulfilled');
    expect(store.fulfill).toHaveBeenCalledWith('local-1', { id: 'CAPTURE1', paypalOrderId: 'PPORDER1', amountCents: 499, currency: 'USD', merchantId: 'MERCHANT1' });
  });
  it.each(['merchant', 'amount', 'currency', 'reference', 'referenceId', 'invoice', 'paypalOrder', 'captureAmount', 'captureCurrency', 'multiple'])('refuses mismatched %s before issuance', async (field) => {
    const { service, gateway, store } = setup();
    const data = remote(); const unit = data.purchase_units[0];
    if (field === 'merchant') unit.payee.merchant_id = 'ATTACKER';
    if (field === 'amount') unit.amount.value = '0.01';
    if (field === 'currency') unit.amount.currency_code = 'EUR';
    if (field === 'reference') unit.custom_id = 'another-order';
    if (field === 'referenceId') unit.reference_id = 'another-order';
    if (field === 'invoice') unit.invoice_id = 'another-order';
    if (field === 'paypalOrder') data.id = 'ANOTHERORDER';
    if (field === 'captureAmount') unit.payments.captures[0].amount.value = '0.01';
    if (field === 'captureCurrency') unit.payments.captures[0].amount.currency_code = 'EUR';
    if (field === 'multiple') unit.payments.captures.push(unit.payments.captures[0]);
    gateway.getOrder.mockResolvedValue(data);
    await expect(service.capture('user-1', 'local-1')).rejects.toThrow('Payment details do not match');
    expect(store.fulfill).not.toHaveBeenCalled();
  });
  it('continues fulfilling an existing approved order when new purchases are paused', async () => {
    const { gateway, store } = setup();
    const service = new PaymentService({ ...config, enabled: false, creditsEnabled: true }, store, gateway);
    await expect(service.create('user-1', 'starter', 'key')).rejects.toThrow('Checkout is not available');
    await expect(service.capture('user-1', order.id)).resolves.toMatchObject({ status: 'fulfilled' });
    expect(gateway.captureOrder).toHaveBeenCalledWith('PPORDER1', 'local-1');
    expect(store.fulfill).toHaveBeenCalledTimes(1);
  });
  it('keeps PENDING unpaid and recovers a capture that completed despite a capture-request timeout', async () => {
    const { service, gateway, store } = setup();
    gateway.captureOrder.mockRejectedValue(new Error('timeout'));
    expect((await service.capture('user-1', 'local-1')).status).toBe('fulfilled');
    const data = remote(); data.purchase_units[0].payments.captures[0].status = 'PENDING';
    gateway.getOrder.mockResolvedValue(data); store.fulfill.mockClear();
    expect((await service.refresh('user-1', 'local-1')).status).toBe('created');
    expect(store.fulfill).not.toHaveBeenCalled();
  });
  it('verifies webhooks before persistence and retries unfinished inbox work while skipping completed duplicates', async () => {
    const { service, gateway, store } = setup();
    const event = { id: 'EVENT1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAPTURE1', supplementary_data: { related_ids: { order_id: 'PPORDER1' } } } };
    gateway.verifyWebhook.mockResolvedValueOnce(false);
    await expect(service.webhook(new Headers(), event)).rejects.toThrow('Invalid webhook signature');
    expect(store.recordEvent).not.toHaveBeenCalled();
    await service.webhook(new Headers(), event);
    expect(store.fulfill).toHaveBeenCalledTimes(1);
    expect(store.completeEvent).toHaveBeenCalledWith('EVENT1');
    store.recordEvent.mockResolvedValue(false);
    await service.webhook(new Headers(), event);
    expect(store.fulfill).toHaveBeenCalledTimes(1);
  });
  it('takes refund capture links only as resource ids, re-fetches the refund and never grants a refunded capture', async () => {
    const { service, gateway, store } = setup();
    gateway.getRefund.mockResolvedValue({ id: 'REFUND1', status: 'COMPLETED', amount: { currency_code: 'USD', value: '4.99' }, links: [{ rel: 'up', href: 'https://api.sandbox.paypal.com/v2/payments/captures/CAPTURE1' }] });
    await service.webhook(new Headers(), { id: 'EVENT2', event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: { id: 'REFUND1' } });
    expect(store.applyAdjustment).toHaveBeenCalledWith('refund:REFUND1', 'CAPTURE1', 'refund', 499);
    expect(store.fulfill).not.toHaveBeenCalled();
  });
  it('leaves pending completed/refund notifications retryable until the authoritative resource settles', async () => {
    const { service, gateway, store } = setup();
    const pending = remote(); pending.purchase_units[0].payments.captures[0].status = 'PENDING';
    gateway.getOrder.mockResolvedValueOnce(pending);
    const event = { id: 'EVENTPENDING', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAPTURE1' } };
    await expect(service.webhook(new Headers(), event)).rejects.toThrow('still being confirmed');
    expect(store.completeEvent).not.toHaveBeenCalled();
    await service.webhook(new Headers(), event);
    expect(store.fulfill).toHaveBeenCalledTimes(1);
    gateway.getRefund.mockResolvedValue({ id: 'REFUND2', status: 'PENDING' });
    await expect(service.webhook(new Headers(), { id: 'EVENTREFUNDPENDING', event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: { id: 'REFUND2' } })).rejects.toThrow('still being confirmed');
    expect(store.completeEvent).not.toHaveBeenCalledWith('EVENTREFUNDPENDING');
  });
  it('rechecks fulfilled purchases and freezes a remotely refunded capture even if its webhook was missed', async () => {
    const { service, gateway, store } = setup();
    store.getOrder.mockResolvedValue({ ...order, status: 'fulfilled' });
    const data = remote(); data.purchase_units[0].payments.captures[0].status = 'REFUNDED';
    gateway.getOrder.mockResolvedValue(data);
    await service.refresh('user-1', 'local-1');
    expect(store.applyAdjustment).toHaveBeenCalledWith('capture-state:CAPTURE1:REFUNDED', 'CAPTURE1', 'reversal', 0);
  });
  it('distinguishes a declined instrument from unknown capture results without issuing credits', async () => {
    const { service, gateway, store } = setup();
    gateway.captureOrder.mockRejectedValue(new PayPalIssueError('INSTRUMENT_DECLINED'));
    await expect(service.capture('user-1', 'local-1')).rejects.toMatchObject({ status: 422, code: 'INSTRUMENT_DECLINED' });
    expect(store.fulfill).not.toHaveBeenCalled();
  });
});
