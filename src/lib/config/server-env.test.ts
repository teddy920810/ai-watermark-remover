import { describe, expect, it } from 'vitest';
import { getServerEnv } from './server-env';

const completeEnv = {
  R2_ACCESS_KEY_ID: 'access-key',
  R2_SECRET_ACCESS_KEY: 'secret-key',
  R2_BUCKET: 'watermark',
  R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
  MOCK_PROCESSING_DELAY_MS: '0',
};

describe('getServerEnv', () => {
  it('parses a complete explicit environment without reading process globals', () => {
    expect(getServerEnv(completeEnv)).toMatchObject({
      R2_ACCESS_KEY_ID: 'access-key',
      R2_SECRET_ACCESS_KEY: 'secret-key',
      R2_BUCKET: 'watermark',
      R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
      MOCK_PROCESSING_DELAY_MS: 0,
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
});
