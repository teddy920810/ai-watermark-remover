import { describe, expect, it } from 'vitest';
import { appOperationPath, resolveAppEntry, identityHasChanged } from './app-entry';

describe('one App entry with compatible operation and task links', () => {
  it('keeps an existing durable task ahead of a new operation recommendation', () => {
    expect(resolveAppEntry({ kind: 'image', requested: 'background-removal', hasJob: true, source: '/remove-object' }).operation).toBe('image-watermark');
    expect(resolveAppEntry({ kind: 'video', requested: 'object-removal', hasJob: true }).operation).toBe('video-watermark');
  });
  it('recommends only compatible catalog operations and explains incompatible or unknown choices', () => {
    expect(resolveAppEntry({ kind: 'image', source: '/remove-background' }).operation).toBe('background-removal');
    expect(resolveAppEntry({ kind: 'image', source: 'remove-object' }).operation).toBe('object-removal');
    expect(resolveAppEntry({ kind: 'image', requested: 'image-watermark-pro' }).operation).toBe('image-watermark-pro');
    expect(resolveAppEntry({ kind: 'video', source: '/remove-background' })).toMatchObject({ operation: 'video-watermark', notice: expect.any(String) });
    expect(resolveAppEntry({ kind: 'image', requested: 'audio-removal' })).toMatchObject({ operation: 'image-watermark', notice: expect.any(String) });
    expect(resolveAppEntry({ kind: 'image', requested: 'image-refine' })).toMatchObject({ operation: 'image-watermark', notice: expect.any(String) });
  });
  it('uses the same product entry for operation changes without carrying an old job or trusted amount', () => {
    expect(appOperationPath('background-removal')).toBe('/app?operation=background-removal');
    expect(appOperationPath('video-watermark')).toBe('/app?operation=video-watermark');
  });
  it('retains initial anonymous sign-in input while isolating changes from an authenticated owner', () => {
    expect(identityHasChanged(undefined, 'a')).toBe(false);
    expect(identityHasChanged('a', 'a')).toBe(false);
    expect(identityHasChanged('a', 'b')).toBe(true);
    expect(identityHasChanged('a', undefined)).toBe(true);
  });
});
