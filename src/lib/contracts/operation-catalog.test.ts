import { describe, expect, it } from 'vitest';
import { operationCatalog, durableOperationIds, durableCapabilities } from './operation-catalog';
import { operationSchema } from '../processing/contracts';

describe('product operation catalog', () => {
  it('covers all six capabilities through the current processing protocol', () => {
    expect(Object.keys(operationCatalog)).toEqual(['image-watermark', 'image-watermark-pro', 'image-refine', 'video-watermark', 'background-removal', 'object-removal']);
    expect(durableOperationIds).toEqual(operationSchema.options);
    expect(operationCatalog['background-removal'].protocol).toBe('v1');
    expect(operationCatalog['object-removal'].input).toBe('image-and-mask');
  });
  it('projects existing limits without enabling audio or leaking execution configuration', () => {
    const caps = durableCapabilities(false, 'disabled');
    expect(caps.map(c => c.operation)).toEqual(durableOperationIds);
    expect(caps.every(c => !c.enabled && c.reason === 'disabled')).toBe(true);
    expect(caps.find(c => c.operation === 'video-watermark')).toMatchObject({ acceptedTypes: ['video/mp4'], maxBytes: 100 * 1024 * 1024, requiredFps: 24, maxDurationSeconds: 540 });
    expect(caps.find(c => c.operation === 'image-refine')).toMatchObject({ acceptedTypes: ['image/jpeg'], maxBytes: 48 * 1024 * 1024 });
    expect(JSON.stringify(operationCatalog)).not.toMatch(/apiKey|secret|accessKey|audio\//);
    expect(durableCapabilities(true).every(c => c.enabled && !('reason' in c))).toBe(true);
  });
});
