import type { WatermarkProvider } from '../providers/watermark-provider';
import { isUploadKey } from '../upload/validation';
import { createJob, failJob, finishJob, type Job } from './job';
import type { JobStore } from './job-store';

interface JobServiceDependencies {
  jobStore: JobStore;
  objects: { exists(key: string): Promise<boolean> };
  provider: WatermarkProvider;
}

export class JobService {
  constructor(
    private readonly dependencies: JobServiceDependencies,
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {}

  async create(inputKey: string, ownerId: string): Promise<Job> {
    if (!isUploadKey(inputKey)) throw new Error('Invalid upload key');
    if (!(await this.dependencies.objects.exists(inputKey))) throw new Error('Upload not found');

    let job = createJob(this.createId(), inputKey, ownerId);
    await this.dependencies.jobStore.save(job);

    try {
      const result = await this.dependencies.provider.remove({ jobId: job.id, inputKey });
      if (result.status === 'completed') {
        job = finishJob(job, result.resultKey);
        await this.dependencies.jobStore.save(job);
      }
    } catch {
      job = failJob(job, 'Image processing failed. Please try again.');
      await this.dependencies.jobStore.save(job);
    }

    return job;
  }

  get(id: string): Promise<Job | null> {
    return this.dependencies.jobStore.get(id);
  }
}
