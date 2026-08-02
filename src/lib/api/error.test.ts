import { describe, expect, it } from 'vitest';
import { publicApiError } from './error';

describe('publicApiError', () => {
  it('hides environment names and validation internals', () => {
    const internal = new Error('[{"path":["R2_SECRET_ACCESS_KEY"],"message":"expected string"}]');
    expect(publicApiError(internal, 'Upload service is temporarily unavailable.')).toBe(
      'Upload service is temporarily unavailable.',
    );
  });

  it('allows an explicit safe domain message', () => {
    expect(publicApiError(new Error('Upload not found'), 'Unable to create job', ['Upload not found']))
      .toBe('Upload not found');
  });
});
