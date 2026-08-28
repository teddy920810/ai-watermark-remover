import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { DewatermarkProvider } from './dewatermark-provider';

function createObjects() {
  return {
    getBytes: vi.fn(async () => sharp({
      create: { width: 1, height: 1, channels: 3, background: '#ffffff' },
    }).png().toBuffer()),
    putBytes: vi.fn().mockResolvedValue(undefined),
  };
}

describe('DewatermarkProvider', () => {
  it('preserves the documented v3 multipart contract and stores the decoded result', async () => {
    const objects = createObjects();
    const processed = Buffer.from('processed-image');
    const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const form = init?.body as FormData;
      const image = form.get('original_preview_image') as File;
      expect(image).toBeInstanceOf(Blob);
      expect(image.type).toBe('image/jpeg');
      expect(image.name).toBe('image.jpg');
      expect(form.get('remove_text')).toBe('false');
      expect(form.get('predict_mode')).toBe('4.0');
      expect([...form.keys()]).toEqual(['original_preview_image', 'remove_text', 'predict_mode']);
      return new Response(JSON.stringify({
        edited_image: { image: processed.toString('base64'), image_id: 'provider-image' },
        event_id: 'provider-event',
        session_id: 'provider-session',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const provider = new DewatermarkProvider(objects, {
      apiKey: 'server-only-key',
      baseUrl: 'https://platform.dewatermark.ai',
      predictMode: '4.0',
      timeoutMs: 30_000,
    }, request as typeof fetch);

    await expect(provider.remove({ jobId: 'job-1', inputKey: 'uploads/source.png' })).resolves.toEqual({
      status: 'completed', resultKey: 'results/job-1.jpg',
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toBe('https://platform.dewatermark.ai/api/object_removal/v3/erase_watermark');
    expect(request.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST', headers: { 'X-API-KEY': 'server-only-key' },
    });
    expect(objects.getBytes).toHaveBeenCalledWith('uploads/source.png');
    expect(objects.putBytes).toHaveBeenCalledWith('results/job-1.jpg', processed, 'image/jpeg');
  });

  it('does not retry or expose a provider response body when the request fails', async () => {
    const objects = createObjects();
    const request = vi.fn().mockResolvedValue(new Response('secret provider detail', { status: 503 }));
    const provider = new DewatermarkProvider(objects, {
      apiKey: 'server-only-key',
      baseUrl: 'https://platform.dewatermark.ai',
      predictMode: '4.0',
      timeoutMs: 30_000,
    }, request as typeof fetch);

    await expect(provider.remove({ jobId: 'job-1', inputKey: 'uploads/source.png' }))
      .rejects.toThrow('Dewatermark request failed with status 503');
    expect(request).toHaveBeenCalledTimes(1);
    expect(objects.putBytes).not.toHaveBeenCalled();
  });

  it('rejects an invalid success response without storing it', async () => {
    const objects = createObjects();
    const request = vi.fn().mockResolvedValue(new Response('{"edited_image":{}}', {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    const provider = new DewatermarkProvider(objects, {
      apiKey: 'server-only-key',
      baseUrl: 'https://platform.dewatermark.ai',
      predictMode: '4.0',
      timeoutMs: 30_000,
    }, request as typeof fetch);

    await expect(provider.remove({ jobId: 'job-1', inputKey: 'uploads/source.png' }))
      .rejects.toThrow('Dewatermark returned an invalid response');
    expect(objects.putBytes).not.toHaveBeenCalled();
  });
});
