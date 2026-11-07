import { describe, expect, it } from 'vitest';
import { creditCost, creditPolicy, rewardAmount, creditsConfiguration } from './credit-policy';
import { operationCatalog } from '../contracts/operation-catalog';

describe('approved universal Credits policy', () => {
  it('allows the same new currency for every currently supported operation', () => {
    for (const operation of Object.values(operationCatalog)) expect(operation.units as readonly string[]).toContain('credits');
  });
  it.each([['image-watermark', 100], ['image-watermark-pro', 300], ['image-refine', 100], ['background-removal', 10], ['object-removal', 10]] as const)('prices %s in the same Credits unit', (operation, amount) => {
    expect(creditCost(operation)).toBe(amount);
  });
  it.each([[1.999, 100], [2, 100], [2.001, 200], [3, 200], [5, 300], [540, 27000]])('preserves video tiers at %s seconds', (durationSeconds, amount) => {
    expect(creditCost('video-watermark', durationSeconds)).toBe(amount);
  });
  it.each([0, -1, NaN, Infinity, undefined, 541])('rejects invalid video duration %s', duration => {
    expect(() => creditCost('video-watermark', duration)).toThrow();
  });
  it('caps only reward issuance and never cuts an existing balance or a refund', () => {
    expect(rewardAmount(250, 0)).toBe(50);
    expect(rewardAmount(200, 100)).toBe(0);
    expect(rewardAmount(400, 0)).toBe(0);
    expect(rewardAmount(0, 0)).toBe(100);
    expect(creditPolicy.conversion).toEqual({ purchase: 1, formalProcessing: 100, freeUse: 100 });
  });
  it('requires an explicit valid admission configuration, keeping purchases unrelated and disabled by this policy', () => {
    expect(creditsConfiguration({})).toMatchObject({ admissionEnabled: false, environment: 'sandbox' });
    expect(creditsConfiguration({ UNIVERSAL_CREDITS_ENABLED: 'true', PAYPAL_ENVIRONMENT: 'live' })).toMatchObject({ admissionEnabled: true, environment: 'live' });
    expect(() => creditsConfiguration({ UNIVERSAL_CREDITS_ENABLED: 'yes' })).toThrow();
  });
});
