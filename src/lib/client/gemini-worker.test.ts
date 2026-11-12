import { afterEach, expect, it, vi } from 'vitest';
import { removeWatermarkFromImageDataSync } from '../../vendor/gemini/engine.js';

vi.mock('../../vendor/gemini/engine.js', () => ({
  removeWatermarkFromImageDataSync: vi.fn(),
  inspectGeminiVideoFile: vi.fn(),
  removeGeminiVideoWatermark: vi.fn(),
}));

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); vi.resetModules(); });

it('exports the engine pixel array without copying it and closes the input bitmap', async () => {
  const pixels = new Uint8ClampedArray([64, 96, 128, 0, 32, 48, 64, 128]);
  const close = vi.fn();
  const postMessage = vi.fn();
  const putImageData = vi.fn();
  const blob = new Blob(['png'], { type: 'image/png' });
  const convertToBlob = vi.fn().mockResolvedValue(blob);
  const scope = { onmessage: null as ((event: MessageEvent) => Promise<void>) | null, postMessage };
  vi.stubGlobal('self', scope);
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 2, height: 1, close }));
  vi.stubGlobal('OffscreenCanvas', class {
    getContext() { return { drawImage: vi.fn(), getImageData: () => ({ width: 2, height: 1, data: new Uint8ClampedArray(8) }), putImageData }; }
    convertToBlob = convertToBlob;
  });
  vi.stubGlobal('ImageData', class {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  });
  vi.mocked(removeWatermarkFromImageDataSync).mockReturnValue({
    imageData: { width: 2, height: 1, data: pixels }, meta: { applied: true, bestEffort: true },
  });

  await import('./gemini-worker');
  await scope.onmessage!({ data: { file: new File(['image'], 'input.png', { type: 'image/png' }), mode: 'process' } } as MessageEvent);

  expect(putImageData).toHaveBeenCalledOnce();
  expect(putImageData.mock.calls[0][0].data).toBe(pixels);
  expect(putImageData.mock.calls[0]).toEqual([expect.objectContaining({ width: 2, height: 1 }), 0, 0]);
  expect(convertToBlob).toHaveBeenCalledWith({ type: 'image/png' });
  expect(postMessage).toHaveBeenLastCalledWith({ info: { kind: 'image', width: 2, height: 1 }, blob, bestEffort: true });
  expect(close).toHaveBeenCalledOnce();
});
