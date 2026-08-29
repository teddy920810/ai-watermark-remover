import { describe, expect, it } from 'vitest';
import { getServerEnv } from './server-env';

const completeEnv = {
  R2_ACCESS_KEY_ID: 'access-key',
  R2_SECRET_ACCESS_KEY: 'secret-key',
  R2_BUCKET: 'watermark',
  R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
  MOCK_PROCESSING_DELAY_MS: '0',
  DATABASE_URL: 'postgresql://user:password@example.neon.tech/database?sslmode=require',
};

describe('getServerEnv', () => {
  it('parses a complete explicit environment without reading process globals', () => {
    expect(getServerEnv(completeEnv)).toMatchObject({
      R2_ACCESS_KEY_ID: 'access-key',
      R2_SECRET_ACCESS_KEY: 'secret-key',
      R2_BUCKET: 'watermark',
      R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
      MOCK_PROCESSING_DELAY_MS: 0,
      DATABASE_URL: 'postgresql://user:password@example.neon.tech/database?sslmode=require',
    });
  });

  it('builds the endpoint from the account ID', () => {
    const withoutEndpoint = Object.fromEntries(Object.entries(completeEnv).filter(([key]) => key !== 'R2_ENDPOINT'));
    expect(getServerEnv({ ...withoutEndpoint, R2_ACCOUNT_ID: 'account-id' }).R2_ENDPOINT)
      .toBe('https://account-id.r2.cloudflarestorage.com');
  });

  it('rejects missing production credentials', () => {
    expect(() => getServerEnv({ R2_ENDPOINT: completeEnv.R2_ENDPOINT })).toThrow();
  });

  it('requires the server-only benefits database URL', () => {
    const withoutDatabase = Object.fromEntries(Object.entries(completeEnv).filter(([key]) => key !== 'DATABASE_URL'));
    expect(() => getServerEnv(withoutDatabase)).toThrow();
  });

  it('requires a server-only API key when the Dewatermark provider is selected', () => {
    expect(() => getServerEnv({ ...completeEnv, WATERMARK_PROVIDER: 'dewatermark' })).toThrow();
    expect(getServerEnv({
      ...completeEnv,
      WATERMARK_PROVIDER: 'dewatermark',
      DEWATERMARK_API_KEY: 'server-only-key',
    })).toMatchObject({
      WATERMARK_PROVIDER: 'dewatermark',
      DEWATERMARK_API_KEY: 'server-only-key',
      DEWATERMARK_BASE_URL: 'https://platform.dewatermark.ai',
      DEWATERMARK_PREDICT_MODE: '4.0',
    });
  });

  it('requires the server-only Replicate token only when background removal is enabled', () => {
    expect(() => getServerEnv({
      ...completeEnv,
      BACKGROUND_REMOVAL_PROVIDER: 'replicate',
    })).toThrow();
    expect(getServerEnv({
      ...completeEnv,
      BACKGROUND_REMOVAL_PROVIDER: 'replicate',
      REPLICATE_API_TOKEN: 'server-only-token',
    })).toMatchObject({
      BACKGROUND_REMOVAL_PROVIDER: 'replicate',
      REPLICATE_API_TOKEN: 'server-only-token',
      REPLICATE_BACKGROUND_MODEL_VERSION: 'a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc',
    });
  });

  it('selects Replicate automatically when its server-only token is configured', () => {
    expect(getServerEnv({
      ...completeEnv,
      REPLICATE_API_TOKEN: 'server-only-token',
    })).toMatchObject({
      BACKGROUND_REMOVAL_PROVIDER: 'replicate',
      REPLICATE_API_TOKEN: 'server-only-token',
    });
  });
});
