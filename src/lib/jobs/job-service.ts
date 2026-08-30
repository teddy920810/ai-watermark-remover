import type { ProviderInput, ProviderResult } from '../providers/watermark-provider';
import { contentTypeForUploadKey, isUploadKey, isUploadKeyForOwner } from '../upload/upload-key';
import { validateUploadMetadata } from '../upload/validation';
import { createJob, failJob, finishJob, type Job, type ProcessingOperation } from './job';
import type { JobStore } from './job-store';
import type { BenefitStore } from '../benefits/benefit-store';

interface JobServiceDependencies {
  jobStore: JobStore;
  objects: {
    head(key: string): Promise<{ contentLength: number; contentType: string } | null>;
    delete(key: string): Promise<void>;
  };
  providers: Record<ProcessingOperation, { remove(input: ProviderInput): Promise<ProviderResult> }>;
  benefits: Pick<BenefitStore, 'reserve' | 'consume' | 'refund'>;
}

export class JobService {
  constructor(
    private readonly dependencies: JobServiceDependencies,
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {}

  async create(
    inputKey: string,
    ownerId: string,
    operation: ProcessingOperation = 'watermark-removal',
    maskKey?: string,
  ): Promise<Job> {
    if (!isUploadKey(inputKey)) throw new Error('Invalid upload key');
    if (!isUploadKeyForOwner(inputKey, ownerId)) throw new Error('Upload not found');

    const metadata = await this.dependencies.objects.head(inputKey);
    if (!metadata) throw new Error('Upload not found');
    const validation = validateUploadMetadata({ contentType: metadata.contentType, size: metadata.contentLength });
    if (!validation.ok || contentTypeForUploadKey(inputKey) !== metadata.contentType) {
      await this.cleanupInput(inputKey);
      throw new Error('Invalid uploaded image');
    }

    if (operation === 'object-removal') {
      if (!maskKey || maskKey === inputKey || !isUploadKey(maskKey) || !isUploadKeyForOwner(maskKey, ownerId)) {
        throw new Error('Mask not found');
      }
      const maskMetadata = await this.dependencies.objects.head(maskKey);
      if (!maskMetadata) throw new Error('Mask not found');
      const maskValidation = validateUploadMetadata({ contentType: maskMetadata.contentType, size: maskMetadata.contentLength });
      if (!maskValidation.ok || maskMetadata.contentType !== 'image/png' || contentTypeForUploadKey(maskKey) !== 'image/png') {
        await this.cleanupInputs(inputKey, maskKey);
        throw new Error('Invalid mask image');
      }
    }

    let job = createJob(this.createId(), inputKey, ownerId, undefined, operation, maskKey ?? null);

    try {
      await this.dependencies.benefits.reserve(job.id, ownerId);
    } catch (error) {
      await this.cleanupInputs(inputKey, maskKey);
      throw error;
    }

    try {
      await this.dependencies.jobStore.save(job);
      const result = await this.dependencies.providers[operation].remove({ jobId: job.id, inputKey, maskKey });
      if (result.status === 'completed') {
        job = finishJob(job, result.resultKey);
        await this.dependencies.jobStore.save(job);
        await this.dependencies.benefits.consume(job.id, ownerId);
      }
    } catch {
      job = failJob(job, 'Image processing failed. Please try again.');
      try {
        await this.dependencies.jobStore.save(job);
      } finally {
        try {
          await this.dependencies.benefits.refund(job.id, ownerId);
        } finally {
          await this.cleanupInputs(inputKey, maskKey);
        }
      }
    }

    return job;
  }

  private async cleanupInput(inputKey: string): Promise<void> {
    try {
      await this.dependencies.objects.delete(inputKey);
    } catch {
      // Best-effort cleanup must not replace the safe job failure returned to the client.
    }
  }

  private async cleanupInputs(inputKey: string, maskKey?: string): Promise<void> {
    await this.cleanupInput(inputKey);
    if (maskKey && maskKey !== inputKey) await this.cleanupInput(maskKey);
  }

  get(id: string): Promise<Job | null> {
    return this.dependencies.jobStore.get(id);
  }
}
