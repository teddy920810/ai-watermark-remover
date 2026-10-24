import { describe, expect, it } from 'vitest';
import { operationSchema, metadataSchema, amountSchema } from './contracts';

describe('processing contracts', () => {
  it('separates the four operations from legacy free-use operations', () => {
    expect(operationSchema.parse('image-refine')).toBe('image-refine');
    expect(operationSchema.safeParse('object-removal').success).toBe(false);
  });

  it('requires finite integer processing credits and measured positive metadata', () => {
    expect(amountSchema.safeParse(0.5).success).toBe(false);
    expect(amountSchema.safeParse(-1).success).toBe(false);
    expect(amountSchema.safeParse(0).success).toBe(false);
    expect(metadataSchema.safeParse({ kind: 'video', contentType: 'video/mp4', byteSize: 1, width: 2, height: 2, durationSeconds: Infinity }).success).toBe(false);
  });
});
