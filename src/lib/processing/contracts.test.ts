import { describe, expect, it } from 'vitest';
import { operationSchema, metadataSchema, amountSchema } from './contracts';

describe('processing contracts', () => {
  it('accepts all migrated operations while rejecting the old watermark alias in v1', () => {
    expect(operationSchema.parse('image-refine')).toBe('image-refine');
    expect(operationSchema.parse('object-removal')).toBe('object-removal');
    expect(operationSchema.parse('background-removal')).toBe('background-removal');
    expect(operationSchema.safeParse('watermark-removal').success).toBe(false);
  });

  it('requires finite integer processing credits and measured positive metadata', () => {
    expect(amountSchema.safeParse(0.5).success).toBe(false);
    expect(amountSchema.safeParse(-1).success).toBe(false);
    expect(amountSchema.safeParse(0).success).toBe(false);
    expect(metadataSchema.safeParse({ kind: 'video', contentType: 'video/mp4', byteSize: 1, width: 2, height: 2, durationSeconds: Infinity }).success).toBe(false);
  });
});
