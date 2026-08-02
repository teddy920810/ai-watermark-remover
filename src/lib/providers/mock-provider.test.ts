import { describe, expect, it, vi } from 'vitest';
import { MockWatermarkProvider } from './mock-provider';

describe('MockWatermarkProvider', () => {
  it('copies the input to a result object', async () => {
    const copyObject = vi.fn().mockResolvedValue(undefined);
    const provider = new MockWatermarkProvider({ copyObject }, 0);
    const result = await provider.remove({ jobId: 'job-1', inputKey: 'uploads/source.png' });
    expect(copyObject).toHaveBeenCalledWith('uploads/source.png', 'results/job-1.png');
    expect(result).toEqual({ status: 'completed', resultKey: 'results/job-1.png' });
  });
});
