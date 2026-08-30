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
    expect(parseCreateJob({ inputKey })).toEqual({ inputKey, operation: 'watermark-removal' });
    expect(parseCreateJob({ inputKey, operation: 'background-removal' })).toEqual({
      inputKey,
      operation: 'background-removal',
    });
    const maskKey = 'uploads/users/5bd39a3d505d21099461dc1b7a3f4d9f/8e7756b9-05e5-453a-a477-fca1f0a66846.png';
    expect(parseCreateJob({ inputKey, maskKey, operation: 'object-removal' })).toEqual({
      inputKey,
      maskKey,
      operation: 'object-removal',
    });
  });

  it('requires a distinct PNG mask for object removal', () => {
    const inputKey = 'uploads/users/5bd39a3d505d21099461dc1b7a3f4d9f/eb8fa168-c11c-4e54-8c63-137d649ed1db.webp';
    const jpgMaskKey = 'uploads/users/5bd39a3d505d21099461dc1b7a3f4d9f/8e7756b9-05e5-453a-a477-fca1f0a66846.jpg';
    expect(() => parseCreateJob({ inputKey, operation: 'object-removal' })).toThrow();
    expect(() => parseCreateJob({ inputKey, maskKey: inputKey, operation: 'object-removal' })).toThrow();
    expect(() => parseCreateJob({ inputKey, maskKey: jpgMaskKey, operation: 'object-removal' })).toThrow();
  });

  it('rejects unknown processing operations', () => {
    const inputKey = 'uploads/users/5bd39a3d505d21099461dc1b7a3f4d9f/eb8fa168-c11c-4e54-8c63-137d649ed1db.webp';
    expect(() => parseCreateJob({ inputKey, operation: 'editor' })).toThrow();
  });

  it('rejects arbitrary object keys', () => {
    expect(() => parseCreateJob({ inputKey: 'results/private.png' })).toThrow();
  });
});
