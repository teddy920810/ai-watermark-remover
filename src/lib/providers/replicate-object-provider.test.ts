import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { ReplicateObjectProvider } from './replicate-object-provider';

const MODEL_VERSION = 'cdac78a1bec5b23c07fd29692fb70baa513ea403a39e643c48ec5edadb15fe72';

async function fixture(color: { r: number; g: number; b: number }) {
  return sharp({ create: { width: 4, height: 3, channels: 3, background: color } }).png().toBuffer();
}

describe('ReplicateObjectProvider', () => {
  it('normalizes a matching black-white mask, pins LaMa, and persists the private PNG result', async () => {
    const source = await fixture({ r: 30, g: 60, b: 90 });
    const mask = await sharp({ create: { width: 4, height: 3, channels: 3, background: { r: 0, g: 0, b: 0 } } })
      .composite([{ input: Buffer.from([255, 255, 255]), raw: { width: 1, height: 1, channels: 3 }, left: 1, top: 1 }])
      .png().toBuffer();
    const output = await fixture({ r: 80, g: 100, b: 120 });
    const objects = {
      getBytes: vi.fn(async (key: string) => key.endsWith('mask.png') ? mask : source),
      putBytes: vi.fn().mockResolvedValue(undefined),
      createResultUrl: vi.fn(async (key: string) => `https://private-r2.test/${key.endsWith('mask.png') ? 'mask' : 'image'}`),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === 'https://api.replicate.com/v1/predictions') {
        expect(JSON.parse(String(init?.body))).toEqual({
          version: `allenhooo/lama:${MODEL_VERSION}`,
          input: { image: 'https://private-r2.test/image', mask: 'https://private-r2.test/mask' },
        });
        return Response.json({ id: 'prediction-1', status: 'succeeded', output: 'https://replicate.delivery/output.png' });
      }
      return new Response(output, { status: 200, headers: { 'Content-Type': 'image/png' } });
    });

    const provider = new ReplicateObjectProvider(objects, {
      apiToken: 'server-only-token', baseUrl: 'https://api.replicate.com', modelVersion: MODEL_VERSION,
      timeoutMs: 45_000, waitSeconds: 20,
    }, request as typeof fetch);

    await expect(provider.remove({ jobId: 'job-1', inputKey: 'uploads/source.png', maskKey: 'uploads/mask.png' }))
      .resolves.toEqual({ status: 'completed', resultKey: 'results/object/job-1.png' });
    expect(objects.putBytes).toHaveBeenCalledWith('results/object/job-1.png', expect.any(Uint8Array), 'image/png');
    expect(objects.delete).toHaveBeenCalledWith('uploads/processing/job-1/image.png');
    expect(objects.delete).toHaveBeenCalledWith('uploads/processing/job-1/mask.png');
  });

  it('rejects a missing, empty, or dimension-mismatched mask before contacting Replicate', async () => {
    const source = await fixture({ r: 30, g: 60, b: 90 });
    const emptyMask = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer();
    const objects = {
      getBytes: vi.fn(async (key: string) => key.endsWith('mask.png') ? emptyMask : source),
      putBytes: vi.fn().mockResolvedValue(undefined), createResultUrl: vi.fn(), delete: vi.fn().mockResolvedValue(undefined),
    };
    const request = vi.fn();
    const provider = new ReplicateObjectProvider(objects, {
      apiToken: 'server-only-token', baseUrl: 'https://api.replicate.com', modelVersion: MODEL_VERSION,
      timeoutMs: 45_000, waitSeconds: 20,
    }, request as typeof fetch);

    await expect(provider.remove({ jobId: 'job-1', inputKey: 'uploads/source.png' })).rejects.toThrow('Mask is required');
    await expect(provider.remove({ jobId: 'job-1', inputKey: 'uploads/source.png', maskKey: 'uploads/mask.png' }))
      .rejects.toThrow('Mask dimensions must match');
    expect(request).not.toHaveBeenCalled();
  });
});
