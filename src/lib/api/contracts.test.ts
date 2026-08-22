import { describe, expect, it } from 'vitest';
import { parseCreateJob, parseUploadRequest } from './contracts';

describe('API contracts', () => {
  it('accepts valid upload metadata', () => {
    expect(parseUploadRequest({ contentType: 'image/png', size: 42 })).toEqual({ contentType: 'image/png', size: 42 });
  });

  it('rejects extra upload fields', () => {
    expect(() => parseUploadRequest({ contentType: 'image/png', size: 42, key: 'chosen-by-client' })).toThrow();
  });

  it('accepts an opaque upload key', () => {
    const inputKey = 'uploads/users/5bd39a3d505d21099461dc1b7a3f4d9f/eb8fa168-c11c-4e54-8c63-137d649ed1db.webp';
    expect(parseCreateJob({ inputKey })).toEqual({ inputKey });
  });

  it('rejects arbitrary object keys', () => {
    expect(() => parseCreateJob({ inputKey: 'results/private.png' })).toThrow();
  });
});
