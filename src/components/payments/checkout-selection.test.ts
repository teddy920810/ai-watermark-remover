import { describe, expect, it } from 'vitest';
import { checkoutPath, selectCheckoutSku } from './checkout-selection';

const packages = [{ sku: 'starter' }, { sku: 'plus' }];
describe('untrusted plan selection and retained payment attempts', () => {
  it('accepts only an existing SKU and never accepts a price from the URL', () => {
    expect(selectCheckoutSku(packages, 'plus')).toBe('plus');
    for (const sku of [null, 'unknown', '<script>', 'plus&amount=1']) expect(selectCheckoutSku(packages, sku)).toBe('starter');
    expect(selectCheckoutSku([], 'plus')).toBe('');
    expect(checkoutPath('plus', '/remove-background#tool')).toBe('/app/credits?sku=plus&returnTo=%2Fremove-background%23tool');
    expect(checkoutPath('plus', '//outside.test')).toBe('/app/credits?sku=plus&returnTo=%2Fapp%2Fimage');
  });
  it('preserves the existing attempt even if another SKU is requested or its package has been withdrawn', () => {
    expect(selectCheckoutSku(packages, 'plus', { sku: 'starter', requestKey: 'same-key', orderId: 'same-order' })).toBe('starter');
    expect(selectCheckoutSku(packages, 'plus', { sku: 'retired', requestKey: 'same-key' })).toBe('retired');
  });
});
