import { describe, expect, it, vi } from 'vitest';
import { createJob } from './job';
import { R2JobStore } from './r2-job-store';

describe('R2JobStore', () => {
  it('stores jobs under an isolated jobs prefix', async () => {
    const objects = { putJson: vi.fn(), getJson: vi.fn() };
    const store = new R2JobStore(objects);
    const job = createJob('job-1', 'uploads/input.png', 'google-user-1');
    await store.save(job);
    expect(objects.putJson).toHaveBeenCalledWith('jobs/job-1.json', job);
  });

  it('returns null when a job does not exist', async () => {
    const objects = { putJson: vi.fn(), getJson: vi.fn().mockResolvedValue(null) };
    const store = new R2JobStore(objects);
    await expect(store.get('missing')).resolves.toBeNull();
  });
});
