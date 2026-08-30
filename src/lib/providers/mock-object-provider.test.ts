import { describe, expect, it, vi } from 'vitest';
import { MockObjectProvider } from './mock-object-provider';

describe('MockObjectProvider', () => {
  it('keeps the object-removal contract without contacting an external provider', async () => {
    const objects = { copyObject: vi.fn().mockResolvedValue(undefined) };
    const provider = new MockObjectProvider(objects);

    await expect(provider.remove({ jobId: 'job-1', inputKey: 'uploads/source.png', maskKey: 'uploads/mask.png' }))
      .resolves.toEqual({ status: 'completed', resultKey: 'results/object/job-1.png' });
    expect(objects.copyObject).toHaveBeenCalledWith('uploads/source.png', 'results/object/job-1.png');
  });

  it('requires the same mask input as the real provider', async () => {
    const objects = { copyObject: vi.fn().mockResolvedValue(undefined) };
    const provider = new MockObjectProvider(objects);

    await expect(provider.remove({ jobId: 'job-1', inputKey: 'uploads/source.png' })).rejects.toThrow('Mask is required');
    expect(objects.copyObject).not.toHaveBeenCalled();
  });
});
