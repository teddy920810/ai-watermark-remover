import { describe, expect, it } from 'vitest';
import { R2ObjectStore } from './r2-object-store';

describe('R2ObjectStore', () => {
  it('generates path-style presigned upload URLs for R2', async () => {
    const store = new R2ObjectStore({
      endpoint: 'https://example-account.r2.cloudflarestorage.com',
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key',
      bucket: 'watermark',
    });

    const signedUrl = new URL(await store.createUploadUrl('uploads/test.png', 'image/png'));

    expect(signedUrl.hostname).toBe('example-account.r2.cloudflarestorage.com');
    expect(signedUrl.pathname).toBe('/watermark/uploads/test.png');
  });
});
