import type { ProviderInput, ProviderResult } from '../providers/watermark-provider';
import { contentTypeForUploadKey, isUploadKey, isUploadKeyForOwner } from '../upload/upload-key';
import { validateUploadMetadata } from '../upload/validation';
import { createJob, failJob, finishJob, type Job, type ProcessingOperation } from './job';
import type { JobStore } from './job-store';
import { ImagePriceChangedError, type BenefitStore, type ImageCreditConsent } from '../benefits/benefit-store';
import type { JobRequest, JobRequestStore } from './job-request-store';

interface JobServiceDependencies {
  jobStore: JobStore;
  objects: {
    head(key: string): Promise<{ contentLength: number; contentType: string } | null>;
    delete(key: string): Promise<void>;
  };
  providers: Record<ProcessingOperation, { remove(input: ProviderInput): Promise<ProviderResult> }>;
  benefits: Pick<BenefitStore, 'reserve' | 'consume' | 'refund'>;
  requests?: JobRequestStore;
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
    imageCreditConsent?: ImageCreditConsent,
  ): Promise<Job> {
    if (!isUploadKey(inputKey)) throw new Error('Invalid upload key');
    if (!isUploadKeyForOwner(inputKey, ownerId)) throw new Error('Upload not found');

    if (this.dependencies.requests) {
      if (operation === 'object-removal' && (!maskKey || maskKey === inputKey || !isUploadKeyForOwner(maskKey, ownerId))) {
        throw new Error('Mask not found');
      }
      return this.createDurable(createJob(this.createId(), inputKey, ownerId, undefined, operation, maskKey ?? null), imageCreditConsent);
    }

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
      await this.reserve(job, imageCreditConsent);
    } catch (error) {
      if (!(error instanceof ImagePriceChangedError)) await this.cleanupInputs(inputKey, maskKey);
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

  private reserve(job: Job, consent?: ImageCreditConsent): Promise<void> {
    return consent
      ? this.dependencies.benefits.reserve(job.id, job.ownerId, job.operation, consent)
      : this.dependencies.benefits.reserve(job.id, job.ownerId, job.operation);
  }

  private async createDurable(candidate: Job, consent?: ImageCreditConsent): Promise<Job> {
    const requests = this.dependencies.requests!;
    const claim = await requests.claim(candidate);
    if (!claim.acquired) return this.recover(claim.request);
    let job = { ...candidate, createdAt: claim.request.createdAt, updatedAt: claim.request.updatedAt };
    try {
      const metadata = await this.dependencies.objects.head(job.inputKey);
      if (!metadata) throw new Error('Upload not found');
      const validation = validateUploadMetadata({ contentType: metadata.contentType, size: metadata.contentLength });
      if (!validation.ok || contentTypeForUploadKey(job.inputKey) !== metadata.contentType) throw new Error('Invalid uploaded image');
      if (job.operation === 'object-removal') {
        const mask = await this.dependencies.objects.head(job.maskKey!);
        if (!mask) throw new Error('Mask not found');
        const validMask = validateUploadMetadata({ contentType: mask.contentType, size: mask.contentLength });
        if (!validMask.ok || mask.contentType !== 'image/png' || contentTypeForUploadKey(job.maskKey!) !== 'image/png') throw new Error('Invalid mask image');
      }
      const active = await requests.expire(job.id);
      if (active.status !== 'processing') return this.recover(active);
      await this.reserve(job, consent);
    } catch (error) {
      if (error instanceof ImagePriceChangedError) {
        // This refusal happened before financial admission or a Provider call.
        // Preserve the upload for the user's next explicit price confirmation.
        // A failed release remains a 503; never pretend another attempt is safe.
        await requests.releaseUnreservedRequest(job.ownerId, job.id);
        throw error;
      }
      await this.recover(await requests.fail(job.id));
      throw error;
    }

    const active = await requests.expire(job.id);
    if (active.status !== 'processing') return this.recover(active);

    try {
      await this.dependencies.jobStore.save(job);
      const result = await this.dependencies.providers[job.operation].remove({ jobId: job.id, inputKey: job.inputKey, maskKey: job.maskKey ?? undefined });
      if (result.status === 'processing') return job;
      job = finishJob(job, result.resultKey);
      await this.dependencies.jobStore.save(job);
    } catch {
      return this.recover(await requests.fail(job.id));
    }
    // R2 already contains the completed artifact. Settlement failures must leave
    // it completed for recovery, rather than refunding an already delivered job.
    return this.recover(await requests.complete(job.id));
  }

  private async recover(initial: JobRequest): Promise<Job> {
    const requests = this.dependencies.requests!;
    let state = initial;
    const base = createJob(state.id, state.inputKey, state.ownerId, state.createdAt, state.operation, state.maskKey);
    let stored = await this.dependencies.jobStore.get(state.id);
    if (stored && (stored.ownerId !== state.ownerId || stored.inputKey !== state.inputKey || stored.operation !== state.operation || stored.maskKey !== state.maskKey)) {
      throw new Error('Invalid persisted job');
    }
    if (state.status === 'processing' && stored?.status === 'completed') state = await requests.complete(state.id);
    if (state.status === 'processing' && stored?.status === 'failed') state = await requests.fail(state.id);
    if (state.status === 'processing') state = await requests.expire(state.id);
    if (state.status === 'processing') return stored ?? base;

    const reservation = await requests.reservationStatus(state.id, state.ownerId);
    if (state.status === 'completed') {
      if (stored?.status !== 'completed') stored = await this.dependencies.jobStore.get(state.id);
      if (reservation === 'reserved') await this.dependencies.benefits.consume(state.id, state.ownerId);
      else if (reservation !== 'consumed') throw new Error('Processing settlement unavailable');
      return stored?.status === 'completed' ? stored : failJob(base, 'Result expired. Please upload the image again.');
    }

    const failed = stored?.status === 'failed' ? stored : failJob(base, 'Image processing failed. Please try again.');
    const needsCleanup = stored?.status !== 'failed' || reservation === 'reserved';
    try {
      if (stored?.status !== 'failed') await this.dependencies.jobStore.save(failed);
    } finally {
      try {
        if (reservation === 'reserved') await this.dependencies.benefits.refund(state.id, state.ownerId);
      } finally {
        if (needsCleanup) await this.cleanupInputs(state.inputKey, state.maskKey ?? undefined);
      }
    }
    return failed;
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

  async recoverUser(ownerId: string): Promise<void> {
    if (!this.dependencies.requests) return;
    const candidates = await this.dependencies.requests.recoverable(ownerId);
    let failed = false;
    for (const request of candidates.slice(0, 20)) {
      if (request.ownerId !== ownerId) continue;
      try { await this.recover(request); }
      catch { failed = true; }
    }
    if (failed) throw new Error('Processing credits are temporarily unavailable');
  }

  async get(id: string, ownerId?: string): Promise<Job | null> {
    if (this.dependencies.requests && ownerId) {
      const request = await this.dependencies.requests.get(id);
      if (request) return request.ownerId === ownerId ? this.recover(request) : null;
    }
    const job = await this.dependencies.jobStore.get(id);
    return ownerId && job?.ownerId !== ownerId ? null : job;
  }
}
