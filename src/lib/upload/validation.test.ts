import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES, validateUploadMetadata } from './validation';
import { createUploadKey, isUploadKeyForOwner } from './upload-key';

describe('upload validation', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts %s', (contentType) => {
    expect(validateUploadMetadata({ contentType, size: 1024 })).toEqual({ ok: true });
  });

  it('rejects unsupported file types', () => {
    expect(validateUploadMetadata({ contentType: 'image/svg+xml', size: 1024 })).toMatchObject({ ok: false });
  });

  it('rejects files larger than 10 MB', () => {
    expect(validateUploadMetadata({ contentType: 'image/png', size: MAX_UPLOAD_BYTES + 1 })).toMatchObject({ ok: false });
  });

  it('creates opaque upload keys with the expected extension', () => {
    expect(createUploadKey('image/webp', 'google-user-1', 'fixed-id')).toBe(
      'uploads/users/5bd39a3d505d21099461dc1b7a3f4d9f/fixed-id.webp',
    );
  });

  it('only accepts upload keys inside the requesting user namespace', () => {
    const key = 'uploads/users/5bd39a3d505d21099461dc1b7a3f4d9f/fixed-id.webp';
    expect(isUploadKeyForOwner(key, 'google-user-1')).toBe(true);
    expect(isUploadKeyForOwner(key, 'google-user-2')).toBe(false);
  });
});
