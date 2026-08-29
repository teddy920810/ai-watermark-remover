import { describe, expect, it, vi } from 'vitest';
import { ReplicateBackgroundProvider } from './replicate-background-provider';

const MODEL_VERSION = 'a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

function createObjects() {
  return {
    createResultUrl: vi.fn().mockResolvedValue('https://private-r2.test/signed-input'),
    putBytes: vi.fn().mockResolvedValue(undefined),
  };
}

describe('ReplicateBackgroundProvider', () => {
  it('pins the documented community model contract and persists the PNG in private R2', async () => {
    const objects = createObjects();
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://api.replicate.com/v1/predictions') {
        expect(init).toMatchObject({
          method: 'POST',
          headers: {
            Authorization: 'Bearer server-only-token',
            'Content-Type': 'application/json',
            Prefer: 'wait=20',
            'Cancel-After': '45s',
          },
        });
        expect(JSON.parse(String(init?.body))).toEqual({
          version: `851-labs/background-remover:${MODEL_VERSION}`,
          input: {
            image: 'https://private-r2.test/signed-input',
            format: 'png',
            reverse: false,
            threshold: 0,
            background_type: 'rgba',
          },
        });
        return Response.json({
          id: 'prediction-1',
          status: 'succeeded',
          output: 'https://replicate.delivery/example/output.png',
        });
      }
      return new Response(png, { status: 200, headers: { 'Content-Type': 'image/png' } });
    });
    const provider = new ReplicateBackgroundProvider(objects, {
      apiToken: 'server-only-token',
      baseUrl: 'https://api.replicate.com',
      modelVersion: MODEL_VERSION,
      timeoutMs: 45_000,
      waitSeconds: 20,
    }, request as typeof fetch);

    await expect(provider.remove({ jobId: 'job-1', inputKey: 'uploads/source.png' })).resolves.toEqual({
      status: 'completed',
      resultKey: 'results/background/job-1.png',
    });
    expect(objects.createResultUrl).toHaveBeenCalledWith('uploads/source.png');
    expect(objects.putBytes).toHaveBeenCalledWith('results/background/job-1.png', expect.any(Uint8Array), 'image/png');
  });

  it('rejects output outside Replicate delivery without fetching or storing it', async () => {
    const objects = createObjects();
    const request = vi.fn().mockResolvedValue(Response.json({
      id: 'prediction-1',
      status: 'succeeded',
      output: 'https://attacker.example/output.png',
    }));
    const provider = new ReplicateBackgroundProvider(objects, {
      apiToken: 'server-only-token',
      baseUrl: 'https://api.replicate.com',
      modelVersion: MODEL_VERSION,
      timeoutMs: 45_000,
      waitSeconds: 20,
    }, request as typeof fetch);

    await expect(provider.remove({ jobId: 'job-1', inputKey: 'uploads/source.png' }))
      .rejects.toThrow('Replicate returned an invalid output');
    expect(request).toHaveBeenCalledTimes(1);
    expect(objects.putBytes).not.toHaveBeenCalled();
  });
});
