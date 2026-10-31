import { describe, expect, it } from 'vitest';
import { imageCreditPrice } from './useImageCreditPrice';
import type { PaymentCatalog } from './payment-client';

const catalog: PaymentCatalog = { enabled: false, creditsEnabled: true, environment: 'sandbox', packages: [], imageCosts: { 'watermark-removal': 100, 'background-removal': 10, 'object-removal': 10 }, imageCostVersion: '2026-10-31-v1' };

describe('displayed image-credit consent', () => {
  it('uses the displayed operation maximum even when new purchases are paused', () => {
    expect(imageCreditPrice(catalog, 'background-removal')).toEqual({ label: '1 free use first; otherwise 10 image credits. Failed operations return their original credit source.', approval: { imageCreditConsent: { imageCostVersion: '2026-10-31-v1', maxImageCredits: 10 } } });
    expect(imageCreditPrice(catalog, 'watermark-removal').approval?.imageCreditConsent?.maxImageCredits).toBe(100);
  });
  it('permits the explicitly disabled paid-wallet free flow without inventing a price', () => {
    expect(imageCreditPrice({ ...catalog, creditsEnabled: false, imageCosts: undefined, imageCostVersion: undefined }, 'object-removal')).toEqual({ label: 'Uses your available free image balance. Failed operations return the reserved free use.', approval: {} });
  });
  it('blocks unknown wallet state or an unavailable, malformed, or unversioned paid price', () => {
    for (const config of [
      { ...catalog, creditsEnabled: undefined },
      { ...catalog, imageCosts: undefined },
      { ...catalog, imageCostVersion: undefined },
      { ...catalog, imageCostVersion: '../invalid version' },
      ...[0, -1, 1.5, 1_000_001].map(cost => ({ ...catalog, imageCosts: { ...catalog.imageCosts!, 'background-removal': cost } })),
    ]) expect(imageCreditPrice(config, 'background-removal').approval).toBeNull();
  });
});
