import { describe, expect, it } from 'vitest';
import { getImageCreditPrices } from './image-credit-prices';

const costs = { 'watermark-removal': 120, 'background-removal': 230, 'object-removal': 340 };
const configured = {
  PAYPAL_CREDITS_ENABLED: 'true', PAYPAL_ENVIRONMENT: 'live',
  PAYPAL_IMAGE_COSTS_JSON: JSON.stringify(costs), PAYPAL_IMAGE_COST_VERSION: 'image-costs-v2',
};

describe('image credit operation prices', () => {
  it('preserves the one-credit Sandbox default without requiring Provider configuration', () => {
    expect(getImageCreditPrices({})).toEqual({ costs: { 'watermark-removal': 1, 'background-removal': 1, 'object-removal': 1 }, version: 'sandbox-image-costs-v1' });
  });

  it('parses three independent positive integer prices and an explicit version', () => {
    expect(getImageCreditPrices(configured)).toEqual({ costs, version: 'image-costs-v2' });
  });

  it.each([
    { PAYPAL_IMAGE_COSTS_JSON: undefined }, { PAYPAL_IMAGE_COST_VERSION: undefined },
    { PAYPAL_IMAGE_COSTS_JSON: '' }, { PAYPAL_IMAGE_COST_VERSION: '' },
  ])('fails closed when a Live wallet lacks approved operation costs or version: %j', (override) => {
    expect(() => getImageCreditPrices({ ...configured, ...override })).toThrow('Live image credits require explicit operation costs and version');
  });

  it('does not substitute Sandbox defaults for existing Live purchases when new checkout is paused', () => {
    expect(() => getImageCreditPrices({ PAYPAL_ENABLED: 'false', PAYPAL_CREDITS_ENABLED: 'true', PAYPAL_ENVIRONMENT: 'live' })).toThrow();
    expect(getImageCreditPrices({ ...configured, PAYPAL_ENABLED: 'false' })).toEqual({ costs, version: 'image-costs-v2' });
  });

  it('also requires prices when the wallet follows an enabled Live checkout', () => {
    expect(() => getImageCreditPrices({ PAYPAL_ENABLED: 'true', PAYPAL_ENVIRONMENT: 'live' })).toThrow();
  });

  it.each([
    { 'watermark-removal': 1, 'background-removal': 2 },
    { ...costs, 'video-watermark': 1 },
    { ...costs, 'watermark-removal': 0 }, { ...costs, 'background-removal': -1 },
    { ...costs, 'object-removal': 1.5 }, { ...costs, 'object-removal': 1_000_001 },
    { ...costs, 'object-removal': Number.MAX_SAFE_INTEGER + 1 }, { ...costs, 'object-removal': '340' },
  ])('rejects incomplete, extra, unsafe or non-integer operation costs: %j', (invalid) => {
    expect(() => getImageCreditPrices({ ...configured, PAYPAL_IMAGE_COSTS_JSON: JSON.stringify(invalid) })).toThrow();
  });

  it('accepts the bounded integer edges and rejects malformed configuration', () => {
    expect(getImageCreditPrices({ ...configured, PAYPAL_IMAGE_COSTS_JSON: JSON.stringify({ 'watermark-removal': 1, 'background-removal': 1_000_000, 'object-removal': 1 }) }).costs['background-removal']).toBe(1_000_000);
    expect(() => getImageCreditPrices({ ...configured, PAYPAL_IMAGE_COSTS_JSON: '{invalid' })).toThrow();
    expect(() => getImageCreditPrices({ ...configured, PAYPAL_IMAGE_COST_VERSION: '   ' })).toThrow();
  });
});
