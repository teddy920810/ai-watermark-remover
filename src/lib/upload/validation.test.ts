import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES, createUploadKey, validateUploadMetadata } from './validation';

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
    expect(createUploadKey('image/webp', 'fixed-id')).toBe('uploads/fixed-id.webp');
  });
});
