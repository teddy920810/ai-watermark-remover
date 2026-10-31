import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPaymentConfig } from './payment-config';

const wallet = {
  PAYPAL_CLIENT_ID: 'test-public-client', PAYPAL_CLIENT_SECRET: 'test-private-secret',
  PAYPAL_MERCHANT_ID: 'TESTMERCHANT', PAYPAL_WEBHOOK_ID: 'TESTWEBHOOK',
};
const providers = {
  WATERMARK_PROVIDER: 'dewatermark', DEWATERMARK_API_KEY: 'test-provider-key',
  REPLICATE_API_TOKEN: 'test-replicate-token', BACKGROUND_REMOVAL_PROVIDER: 'replicate', OBJECT_REMOVAL_PROVIDER: 'replicate',
};
const dispatch = {
  GOOGLE_CLOUD_PROJECT: 'test-project', CLOUD_RUN_REGION: 'asia-east1', CLOUD_RUN_JOB: 'test-worker', CLOUD_RUN_CONTAINER: 'worker',
  GCP_PROJECT_NUMBER: '1234567890', GCP_SERVICE_ACCOUNT_EMAIL: 'web@test-project.iam.gserviceaccount.com',
  GCP_WORKLOAD_IDENTITY_POOL_ID: 'test-pool', GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: 'test-provider',
};
function live(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...wallet, ...providers, ...dispatch,
    PAYPAL_ENABLED: 'true', PAYPAL_CREDITS_ENABLED: 'true', PAYPAL_ENVIRONMENT: 'live', PAYPAL_LIVE_APPROVED: 'true',
    PAYPAL_CATALOG_JSON: JSON.stringify([{ sku: 'image-uses', name: 'Image uses', credits: 5, amountCents: 499, currency: 'USD' }]),
    PAYPAL_CATALOG_VERSION: 'catalog-test-v1',
    PAYPAL_IMAGE_COSTS_JSON: JSON.stringify({ 'watermark-removal': 120, 'background-removal': 230, 'object-removal': 340 }), PAYPAL_IMAGE_COST_VERSION: 'image-costs-v2',
    PROCESSING_ENABLED: 'true', PROCESSING_PROVIDER: 'dewatermark', ...overrides,
  };
}
afterEach(() => vi.unstubAllGlobals());

describe('Live payment admission configuration', () => {
  it.each([undefined, '', 'invalid/version'])('rejects an unversioned or invalid Live catalog: %s', (version) => {
    expect(() => getPaymentConfig(live({ PAYPAL_CATALOG_VERSION: version }))).toThrow();
  });
  it('keeps the default disabled without reading media credentials or dispatch configuration', () => {
    const source: NodeJS.ProcessEnv = {};
    for (const key of ['DATABASE_URL', 'R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'DEWATERMARK_API_KEY', 'REPLICATE_API_TOKEN', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_SERVICE_ACCOUNT_JSON']) {
      Object.defineProperty(source, key, { get() { throw new Error('Unrelated configuration was read'); } });
    }
    expect(getPaymentConfig(source)).toMatchObject({ enabled: false, creditsEnabled: false, environment: 'sandbox' });
  });

  it('allows isolated Sandbox checkout without a real Provider or cloud trigger', () => {
    expect(getPaymentConfig({ ...wallet, PAYPAL_ENABLED: 'true' })).toMatchObject({ enabled: true, environment: 'sandbox' });
  });

  it.each([
    { PAYPAL_LIVE_APPROVED: 'false' }, { PAYPAL_CATALOG_JSON: undefined },
  ])('requires an explicit approved Live catalog: %j', (override) => {
    expect(() => getPaymentConfig(live(override))).toThrow('approved prices');
  });

  it.each([
    { WATERMARK_PROVIDER: 'mock' }, { DEWATERMARK_API_KEY: undefined }, { REPLICATE_API_TOKEN: undefined },
    { BACKGROUND_REMOVAL_PROVIDER: 'mock' }, { OBJECT_REMOVAL_PROVIDER: 'mock' },
  ])('keeps each of the three sold legacy image operations backed by a real Provider: %j', (override) => {
    expect(() => getPaymentConfig(live(override))).toThrow('real processing providers');
  });

  it.each([
    { PROCESSING_ENABLED: undefined }, { PROCESSING_ENABLED: 'false' },
    { PROCESSING_PROVIDER: undefined }, { PROCESSING_PROVIDER: 'mock' },
  ])('rejects unavailable or demo normal-image processing: %j', (override) => {
    expect(() => getPaymentConfig(live(override))).toThrow('real normal-image processing');
  });

  it.each([
    { GOOGLE_CLOUD_PROJECT: undefined, CLOUD_RUN_REGION: undefined, CLOUD_RUN_JOB: undefined },
    { CLOUD_RUN_JOB: undefined }, { CLOUD_RUN_REGION: 'invalid/region' },
    { GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: undefined }, { GCP_AUDIENCE: 'https://wrong-audience.example' },
    { GCP_PROJECT_NUMBER: undefined },
  ])('rejects missing or invalid durable dispatch configuration: %j', (override) => {
    expect(() => getPaymentConfig(live(override))).toThrow('durable processing dispatch');
  });

  it('parses a real normal-image and durable dispatch configuration without token acquisition or network calls', () => {
    const fetcher = vi.fn(() => { throw new Error('Configuration must not perform network requests'); });
    vi.stubGlobal('fetch', fetcher);
    const config = getPaymentConfig(live());
    expect(config).toMatchObject({ enabled: true, creditsEnabled: true, environment: 'live', packages: [{ sku: 'image-uses', credits: 5 }] });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('preserves existing Live image allowances when new checkout is paused, independently of media readiness', () => {
    const config = getPaymentConfig({ PAYPAL_ENABLED: 'false', PAYPAL_CREDITS_ENABLED: 'true', PAYPAL_ENVIRONMENT: 'live', PAYPAL_IMAGE_COSTS_JSON: JSON.stringify({ 'watermark-removal': 120, 'background-removal': 230, 'object-removal': 340 }), PAYPAL_IMAGE_COST_VERSION: 'image-costs-v2' });
    expect(config).toMatchObject({ enabled: false, creditsEnabled: true, environment: 'live' });
  });
  it('exposes explicit operation costs and version and rejects a paused Live wallet without them', () => {
    expect(getPaymentConfig(live())).toMatchObject({ imageCosts: { 'watermark-removal': 120, 'background-removal': 230, 'object-removal': 340 }, imageCostVersion: 'image-costs-v2' });
    expect(() => getPaymentConfig({ PAYPAL_ENABLED: 'false', PAYPAL_CREDITS_ENABLED: 'true', PAYPAL_ENVIRONMENT: 'live' })).toThrow();
  });
});
