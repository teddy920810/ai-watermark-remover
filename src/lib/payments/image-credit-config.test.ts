import { describe, expect, it } from 'vitest';
import { imageCreditConfigFromEnvironment } from './image-credit-config';
const costs = { 'watermark-removal': 3, 'background-removal': 2, 'object-removal': 4 };
const prices = { PAYPAL_IMAGE_COSTS_JSON: JSON.stringify(costs), PAYPAL_IMAGE_COST_VERSION: 'test-image-1' };

describe('image-use environment isolation', () => {
  it('keeps purchased image reads disabled until explicitly enabled', () => {
    expect(imageCreditConfigFromEnvironment({})).toMatchObject({ enabled: false, environment: 'sandbox' });
    expect(imageCreditConfigFromEnvironment({ ...prices, PAYPAL_ENABLED: 'true', PAYPAL_ENVIRONMENT: 'live' })).toEqual({ enabled: true, environment: 'live', costs, priceVersion: 'test-image-1' });
  });
  it('preserves existing purchased uses while new checkout is paused', () => {
    expect(imageCreditConfigFromEnvironment({ ...prices, PAYPAL_ENABLED: 'false', PAYPAL_CREDITS_ENABLED: 'true', PAYPAL_ENVIRONMENT: 'live' })).toMatchObject({ enabled: true, environment: 'live', costs, priceVersion: 'test-image-1' });
    expect(imageCreditConfigFromEnvironment({ PAYPAL_ENABLED: 'true', PAYPAL_CREDITS_ENABLED: 'false' }).enabled).toBe(false);
  });
  it('rejects an unknown financial environment instead of reading another wallet', () => {
    expect(() => imageCreditConfigFromEnvironment({ PAYPAL_CREDITS_ENABLED: 'true', PAYPAL_ENVIRONMENT: 'production' })).toThrow();
  });
  it('refuses an enabled Live wallet without prices instead of quoting a one-credit default', () => {
    expect(() => imageCreditConfigFromEnvironment({ PAYPAL_CREDITS_ENABLED: 'true', PAYPAL_ENVIRONMENT: 'live' })).toThrow();
  });
});
