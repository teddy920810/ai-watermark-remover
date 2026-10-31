import { describe, expect, it } from 'vitest';
import { publicPaymentCatalog, type PaymentConfig } from './payment-config';

const config: PaymentConfig & { futurePrivateCredential: string } = {
  enabled: true, creditsEnabled: true, environment: 'live',
  clientId: 'public-client-id', clientSecret: 'private-client-secret',
  merchantId: 'private-merchant-id', webhookId: 'private-webhook-id',
  futurePrivateCredential: 'future-private-value',
  packages: [{ sku: 'starter', name: 'Starter', credits: 4990, amountCents: 499, currency: 'USD' }],
  catalogVersion: 'approved-catalog-v1',
  imageCosts: { 'watermark-removal': 100, 'background-removal': 10, 'object-removal': 10 },
  imageCostVersion: 'approved-costs-v1',
};

describe('server-rendered public payment catalog', () => {
  it('projects only browser-safe fields, including when future private config is added', () => {
    expect(publicPaymentCatalog(config)).toEqual({
      enabled: true, creditsEnabled: true, environment: 'live', clientId: 'public-client-id',
      packages: config.packages, imageCosts: config.imageCosts, imageCostVersion: config.imageCostVersion,
    });
    const serialized = JSON.stringify(publicPaymentCatalog(config));
    for (const value of [config.clientSecret, config.merchantId, config.webhookId, config.futurePrivateCredential]) {
      expect(serialized).not.toContain(value);
    }
  });

  it('omits the SDK client ID while new checkout is closed without hiding the approved prices', () => {
    const projected = publicPaymentCatalog({ ...config, enabled: false });
    expect(projected).not.toHaveProperty('clientId');
    expect(projected.packages).toEqual(config.packages);
    expect(projected.creditsEnabled).toBe(true);
  });
});
