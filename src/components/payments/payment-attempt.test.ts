import { describe, expect, it } from 'vitest';
import { canResolveAttempt, parsePaymentAttempt, paymentAccountId } from './payment-attempt';

const active = { sku: 'starter', requestKey: 'request-a', orderId: 'order-a' };

describe('active checkout identity', () => {
  it('never clears an unresolved checkout using a historical order of the same SKU', () => {
    expect(canResolveAttempt(active, { id: 'order-b', sku: 'starter', status: 'fulfilled' })).toBe(false);
    expect(canResolveAttempt(active, { id: 'order-a', sku: 'starter', status: 'pending' })).toBe(false);
    expect(canResolveAttempt(active, { id: 'order-a', sku: 'starter', status: 'fulfilled' }, 'new-request')).toBe(false);
    expect(canResolveAttempt(active, { id: 'order-a', sku: 'starter', status: 'fulfilled' }, 'request-a')).toBe(true);
  });

  it('restores only a well-formed user-scoped attempt after refresh', () => {
    expect(parsePaymentAttempt(JSON.stringify(active))).toEqual(active);
    for (const value of [null, '{broken', '{}', JSON.stringify({ sku: 'starter', requestKey: 'request-a', orderId: 4 })]) expect(parsePaymentAttempt(value)).toBeNull();
  });

  it('keys active purchases by the existing signed canonical session ID without a second identity field', () => {
    expect(paymentAccountId({ id: 'canonical-user' })).toBe('canonical-user');
    expect(paymentAccountId({ id: 'other-user', watermarkAccountId: 'stale-marker' })).toBe('other-user');
    expect(paymentAccountId({ id: '' })).toBeNull();
    expect(paymentAccountId(null)).toBeNull();
  });
});
