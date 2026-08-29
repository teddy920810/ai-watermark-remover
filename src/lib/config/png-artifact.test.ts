import { describe, expect, it } from 'vitest';
import { inspectPngArtifact } from '../../../scripts/lib/png-artifact.mjs';

const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAC0lEQVQImWNgQAcAABIAAW/6Y7cAAAAASUVORK5CYII=', 'base64');
const whitePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWP4DwUMMAYAj4IP8cvlVgcAAAAASUVORK5CYII=', 'base64');

describe('PNG artifact inspection', () => {
  it('confirms decodable dimensions and actual transparent pixels', async () => {
    await expect(inspectPngArtifact(transparentPng, { requireTransparency: true })).resolves.toMatchObject({
      format: 'png',
      width: 2,
      height: 2,
      hasTransparentPixel: true,
    });
  });

  it('rejects opaque output when transparency is required', async () => {
    await expect(inspectPngArtifact(whitePng, { requireTransparency: true })).rejects.toThrow('transparent pixel');
  });

  it('can require an exact opaque background color for composed downloads', async () => {
    await expect(inspectPngArtifact(whitePng, { expectedOpaqueColor: [255, 255, 255] })).resolves.toMatchObject({
      hasTransparentPixel: false,
      matchesExpectedOpaqueColor: true,
    });
  });
});
