import { describe, expect, it, vi } from 'vitest';
import { createPaymentCallbacks, orderCheckoutStatus, recoverPaymentOrder, safeReturnPath, type PaymentOrder } from './payment-client';

const order: PaymentOrder = { id: 'local-1', paypalOrderId: 'PAYPAL-1', sku: 'starter', credits: 5, amountCents: 499, currency: 'USD', status: 'pending', createdAt: '2026-10-25T00:00:00Z' };

describe('payment checkout callbacks', () => {
  it('creates only the selected SKU with a stable idempotency key, then captures server-side before showing success', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(order)).mockResolvedValueOnce(Response.json({ ...order, status: 'fulfilled' }));
    const status = vi.fn();
    const save = vi.fn();
    const fulfilled = vi.fn();
    const callbacks = createPaymentCallbacks({ sku: 'starter', requestKey: 'request-1', fetcher, onStatus: status, onOrder: save, onFulfilled: fulfilled });
    expect(await callbacks.createOrder()).toBe('PAYPAL-1');
    expect(fetcher.mock.calls[0]).toEqual(['/api/payments/paypal/orders', expect.objectContaining({ headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'request-1' }, body: JSON.stringify({ sku: 'starter' }) })]);
    expect(fulfilled).not.toHaveBeenCalled();
    await callbacks.onApprove({ orderID: 'PAYPAL-1' });
    expect(fetcher.mock.calls[1][0]).toBe('/api/payments/paypal/orders/local-1/capture');
    expect(fulfilled).toHaveBeenCalledOnce();
    expect(status).toHaveBeenLastCalledWith('fulfilled');
  });

  it('keeps an uncertain capture pending and never invites duplicate payment', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(order)).mockRejectedValueOnce(new Error('Network timeout'));
    const status = vi.fn();
    const fulfilled = vi.fn();
    const callbacks = createPaymentCallbacks({ sku: 'starter', requestKey: 'request-1', fetcher, onStatus: status, onOrder: vi.fn(), onFulfilled: fulfilled });
    await callbacks.createOrder();
    await callbacks.onApprove({ orderID: 'PAYPAL-1' });
    expect(status).toHaveBeenLastCalledWith('confirming');
    expect(fulfilled).not.toHaveBeenCalled();
  });

  it('rejects a mismatched provider approval without capturing another order', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(order));
    const status = vi.fn();
    const callbacks = createPaymentCallbacks({ sku: 'starter', requestKey: 'request-1', fetcher, onStatus: status, onOrder: vi.fn(), onFulfilled: vi.fn() });
    await callbacks.createOrder();
    await callbacks.onApprove({ orderID: 'OTHER' });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(status).toHaveBeenLastCalledWith('error');
  });

  it('does not grant credits for pending captures or browser cancellation', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(order));
    const fulfilled = vi.fn();
    const status = vi.fn();
    const callbacks = createPaymentCallbacks({ sku: 'starter', requestKey: 'request-1', fetcher, onStatus: status, onOrder: vi.fn(), onFulfilled: fulfilled });
    await callbacks.createOrder();
    await callbacks.onApprove({ orderID: 'PAYPAL-1' });
    expect(status).toHaveBeenLastCalledWith('confirming');
    callbacks.onCancel();
    expect(status).toHaveBeenLastCalledWith('cancelled');
    expect(fulfilled).not.toHaveBeenCalled();
  });

  it('keeps return navigation within this product', () => {
    expect(safeReturnPath('/remove-background#tool')).toBe('/remove-background#tool');
    for (const target of [null, 'https://outside.test/', '//outside.test/', '/\\outside.test/', '/pricing', '/app/credits', 'javascript:alert(1)']) expect(safeReturnPath(target)).toBe('/app/image');
  });

  it('shows refunds and review outcomes as terminal rather than waiting for credits forever', () => {
    expect(orderCheckoutStatus('fulfilled')).toBe('fulfilled');
    for (const state of ['refunded', 'review', 'reversed', 'disputed']) expect(orderCheckoutStatus(state)).toBe('review');
    expect(orderCheckoutStatus('created')).toBe('confirming');
  });

  it('recovers a completed idempotent create without opening payment again', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ...order, status: 'fulfilled' }));
    const onStatus = vi.fn();
    const onFulfilled = vi.fn();
    const callbacks = createPaymentCallbacks({ sku: 'starter', requestKey: 'request-1', fetcher, onStatus, onOrder: vi.fn(), onFulfilled });
    await expect(callbacks.createOrder()).rejects.toThrow('already completed');
    expect(onFulfilled).toHaveBeenCalledOnce();
    callbacks.onError();
    expect(onStatus).toHaveBeenLastCalledWith('fulfilled');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('restarts the official checkout on a definitive funding decline', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(order)).mockResolvedValueOnce(Response.json({ error: 'Choose another payment method.', code: 'INSTRUMENT_DECLINED' }, { status: 422 }));
    const onStatus = vi.fn();
    const onFulfilled = vi.fn();
    const restart = vi.fn().mockResolvedValue(undefined);
    const callbacks = createPaymentCallbacks({ sku: 'starter', requestKey: 'request-1', fetcher, onStatus, onOrder: vi.fn(), onFulfilled });
    await callbacks.createOrder();
    await callbacks.onApprove({ orderID: 'PAYPAL-1' }, { restart });
    expect(restart).toHaveBeenCalledOnce();
    expect(onStatus).toHaveBeenLastCalledWith('approving');
    expect(onFulfilled).not.toHaveBeenCalled();
  });

  it('distinguishes definitive payment rejection from an unknown capture outcome', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(order)).mockResolvedValueOnce(Response.json({ code: 'TRANSACTION_REFUSED' }, { status: 422 }));
    const onStatus = vi.fn();
    const callbacks = createPaymentCallbacks({ sku: 'starter', requestKey: 'request-1', fetcher, onStatus, onOrder: vi.fn(), onFulfilled: vi.fn() });
    await callbacks.createOrder();
    await callbacks.onApprove({ orderID: 'PAYPAL-1' });
    expect(onStatus).toHaveBeenLastCalledWith('error');
  });

  it('recovers a lost capture request by capturing the same original order after a read', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ ...order, status: 'created' })).mockResolvedValueOnce(Response.json({ ...order, status: 'fulfilled' }));
    expect((await recoverPaymentOrder(order.id, fetcher)).status).toBe('fulfilled');
    expect(fetcher.mock.calls[0][0]).toBe(`/api/payments/orders/${order.id}`);
    expect(fetcher.mock.calls[1]).toEqual([`/api/payments/paypal/orders/${order.id}/capture`, expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })]);
  });

  it('does not capture a completed or refunded historical order again', async () => {
    for (const status of ['fulfilled', 'refunded', 'review']) {
      const fetcher = vi.fn().mockResolvedValue(Response.json({ ...order, status }));
      expect((await recoverPaymentOrder(order.id, fetcher)).status).toBe(status);
      expect(fetcher).toHaveBeenCalledOnce();
    }
  });

  it('does not reopen a refunded or disputed order from a retained checkout key', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ...order, status: 'refunded' }));
    const onStatus = vi.fn();
    const callbacks = createPaymentCallbacks({ sku: 'starter', requestKey: 'request-1', fetcher, onStatus, onOrder: vi.fn(), onFulfilled: vi.fn() });
    await expect(callbacks.createOrder()).rejects.toThrow('needs review');
    callbacks.onError();
    expect(onStatus).toHaveBeenLastCalledWith('review');
  });
});
