import { describe, expect, it, vi } from 'vitest';
import { launcherLimit } from '../client/media-identification';
import { validateLocalMedia } from '../client/media-drafts';
import { inspectImage, inspectMask } from '../media/image';
import { createProcessingHandler } from '../api/processing-handler';

// A changed catalog must reach every consumer without editing their local defaults.
vi.mock('./operation-catalog', async importOriginal => ({
  ...await importOriginal<typeof import('./operation-catalog')>(),
  IMAGE_MAX_BYTES: 16,
  VIDEO_MAX_BYTES: 32,
}));

describe('shared upload limit consumers', () => {
  it('uses catalog defaults while preserving advertised limits', () => {
    expect(launcherLimit('image')).toBe(16);
    expect(launcherLimit('video')).toBe(32);
    expect(launcherLimit('image', 8)).toBe(8);
    expect(launcherLimit('video', Number.NaN)).toBe(32);
  });
  it.each([['image', 'image/png', 16], ['video', 'video/mp4', 32]] as const)('bounds local %s drafts with the same limit', (kind, type, limit) => {
    expect(validateLocalMedia({ name: 'fixture', type, size: limit }, kind)).toEqual({ ok: true });
    expect(validateLocalMedia({ name: 'fixture', type, size: limit + 1 }, kind).ok).toBe(false);
    expect(validateLocalMedia({ name: 'fixture', type, size: limit + 1 }, kind, limit + 1).ok).toBe(true);
  });
  it('bounds server image and mask decoding before reading pixels', async () => {
    await expect(inspectImage(new Uint8Array(17))).rejects.toThrow('Image exceeds the byte limit');
    await expect(inspectMask(new Uint8Array(17), { width: 1, height: 1 })).rejects.toThrow('Image exceeds the byte limit');
  });
  it('rejects oversized v1 declarations before starting an upload', async () => {
    const beginUpload = vi.fn();
    const handler = createProcessingHandler({ origin: 'https://example.test', getSession: async () => ({ user: { id: 'owner' } }), getRuntime: () => ({ beginUpload }) as never });
    const response = await handler(new Request('https://example.test/api/v1/uploads', { method: 'POST', headers: { Origin: 'https://example.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'video', contentType: 'video/mp4', byteSize: 33 }) }));
    expect(response.status).toBe(400);
    expect(beginUpload).not.toHaveBeenCalled();
  });
});
