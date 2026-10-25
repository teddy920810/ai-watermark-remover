import { createHash, randomUUID } from 'node:crypto';
import { amountSchema, metadataSchema, operationSchema, ProcessingError } from './contracts';
import type { AdmissionHistoryCursor, OperationCapability, ProcessingArtifact, ProcessingArtifactStore, ProcessingFinancialStore, ProcessingInspector, ProcessingJob, ProcessingJobStore, ProcessingOperation, ProcessingPriceBook, ProcessingQuote, ProcessingQuoteStore } from './contracts';

export interface QuoteRequest { ownerId: string; operation: ProcessingOperation; inputArtifactId: string; maskArtifactId?: string; parentJobId?: string }
export interface SubmitRequest { ownerId: string; quoteId: string; idempotencyKey: string }
export interface ProcessingServiceOptions {
  jobs: ProcessingJobStore;
  artifacts: ProcessingArtifactStore;
  quotes: ProcessingQuoteStore;
  finance: ProcessingFinancialStore;
  inspector: ProcessingInspector;
  capabilities: OperationCapability[];
  prices: ProcessingPriceBook;
  now?: () => Date;
  id?: () => string;
  quoteTtlMs?: number;
}

export class ProcessingService {
  private readonly now: () => Date;
  private readonly id: () => string;
  constructor(private readonly options: ProcessingServiceOptions) { this.now = options.now ?? (() => new Date()); this.id = options.id ?? randomUUID; }

  capabilities(): OperationCapability[] { return structuredClone(this.options.capabilities); }

  async preflight(ownerId: string, artifactId: string): Promise<ProcessingArtifact> {
    const artifact = await this.options.inspector.inspect(ownerId, artifactId);
    if (artifact.ownerId !== ownerId) throw new ProcessingError('not_found', 'File not found', 404);
    metadataSchema.parse(artifact.metadata);
    if (!artifact.sealed) throw new ProcessingError('input_not_sealed', 'Input inspection has not completed', 409);
    await this.options.artifacts.create(artifact);
    return artifact;
  }

  async quote(request: QuoteRequest): Promise<ProcessingQuote> {
    operationSchema.parse(request.operation);
    const { input, mask } = await this.validate(request);
    const unit = request.operation === 'image-watermark' && await this.options.finance.getBalance(request.ownerId, 'freeUses') >= 1 ? 'freeUses' : 'processingCredits';
    const amount = unit === 'freeUses' ? 1 : amountSchema.parse(this.options.prices.amount(request.operation, input.metadata));
    const now = this.now();
    const quote: ProcessingQuote = {
      ...request, id: this.id(), amount, unit, priceVersion: this.options.prices.version,
      fingerprint: this.fingerprint(request, input, mask), createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + (this.options.quoteTtlMs ?? 10 * 60_000)).toISOString(),
    };
    await this.options.quotes.create(quote);
    return quote;
  }

  async submit(request: SubmitRequest): Promise<ProcessingJob> {
    if (!request.idempotencyKey || request.idempotencyKey.length > 200) throw new ProcessingError('invalid_operation_key', 'An operation key is required');
    const prior = await this.options.finance.findAdmission(request.ownerId, request.idempotencyKey);
    if (prior) {
      const accepted = await this.get(request.ownerId, prior.jobId);
      // An accepted task's sealed quote survives its short-lived quote object.
      // Recovery must not revalidate expiry, current price, availability or balance.
      if (accepted.quote.id !== request.quoteId || prior.requestHash !== this.requestHash(accepted.quote)) throw new ProcessingError('idempotency_conflict', 'This operation key belongs to another request', 409);
      return accepted;
    }
    const quote = await this.options.quotes.get(request.quoteId);
    if (!quote || quote.ownerId !== request.ownerId) throw new ProcessingError('not_found', 'Quote not found', 404);
    const requestHash = this.requestHash(quote);
    if (Date.parse(quote.expiresAt) <= this.now().getTime()) throw new ProcessingError('quote_expired', 'Confirm a new quote before processing', 409);
    const { input, mask } = await this.validate(quote);
    if (this.fingerprint(quote, input, mask) !== quote.fingerprint || quote.priceVersion !== this.options.prices.version) throw new ProcessingError('quote_changed', 'Input or price changed; confirm a new quote', 409);
    const now = this.now().toISOString();
    const job: ProcessingJob = {
      id: this.id(), ownerId: request.ownerId, operation: quote.operation, status: 'PREPARED', quote,
      inputArtifactId: quote.inputArtifactId, ...(quote.maskArtifactId ? { maskArtifactId: quote.maskArtifactId } : {}),
      ...(quote.parentJobId ? { parentJobId: quote.parentJobId } : {}), chargeStatus: 'reserved', createdAt: now, updatedAt: now,
    };
    if (!await this.options.jobs.create(job)) throw new ProcessingError('job_conflict', 'Could not create processing operation', 409);
    const { admission } = await this.options.finance.reserveAndEnqueue({ jobId: job.id, ownerId: job.ownerId, idempotencyKey: request.idempotencyKey, requestHash, amount: quote.amount, unit: quote.unit, now });
    if (admission.jobId !== job.id) return this.get(request.ownerId, admission.jobId);
    const stored = await this.options.jobs.get(job.id);
    if (stored?.job.status === 'PREPARED') await this.options.jobs.compareAndSwap(job.id, stored.version, { ...stored.job, status: 'QUEUED', updatedAt: now });
    return this.get(request.ownerId, job.id);
  }

  async get(ownerId: string, jobId: string): Promise<ProcessingJob> {
    const stored = await this.options.jobs.get(jobId);
    if (!stored || stored.job.ownerId !== ownerId) throw new ProcessingError('not_found', 'Task not found', 404);
    const admission = await this.options.finance.getAdmission(jobId);
    if (!admission || admission.ownerId !== ownerId) throw new ProcessingError('not_found', 'Task not found', 404);
    return stored.job;
  }

  async list(ownerId: string, limit = 20): Promise<ProcessingJob[]> {
    const pageSize = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.trunc(limit))) : 20;
    const jobs: ProcessingJob[] = []; let before: AdmissionHistoryCursor | undefined;
    // Financial admission defines history membership. The R2 owner index also
    // contains abandoned PREPARED manifests and cannot be limited before filtering.
    do {
      const page = await this.options.finance.listAdmissionsForOwner(ownerId, pageSize, before);
      const records = await Promise.all(page.admissions.map(async (entry) => {
        if (entry.ownerId !== ownerId) return null;
        const stored = await this.options.jobs.get(entry.jobId);
        return stored?.job.id === entry.jobId && stored.job.ownerId === ownerId ? stored.job : null;
      }));
      jobs.push(...records.filter((job): job is ProcessingJob => job !== null));
      before = page.nextCursor;
    } while (jobs.length < pageSize && before);
    return jobs.slice(0, pageSize);
  }

  private async owned(ownerId: string, id: string): Promise<ProcessingArtifact> {
    const artifact = await this.options.artifacts.get(id);
    if (!artifact || artifact.ownerId !== ownerId) throw new ProcessingError('not_found', 'File not found', 404);
    if (!artifact.sealed) throw new ProcessingError('input_not_sealed', 'Wait for file inspection before processing', 409);
    if (Date.parse(artifact.expiresAt) <= this.now().getTime()) throw new ProcessingError('file_expired', 'File has reached its retention limit', 410);
    metadataSchema.parse(artifact.metadata);
    return artifact;
  }

  private async validate(request: QuoteRequest): Promise<{ input: ProcessingArtifact; mask?: ProcessingArtifact }> {
    const capability = this.options.capabilities.find((c) => c.operation === request.operation);
    if (!capability?.enabled) throw new ProcessingError('operation_unavailable', capability?.reason ?? 'This operation is not available', 503);
    const input = await this.owned(request.ownerId, request.inputArtifactId);
    if (input.role === 'mask') throw new ProcessingError('invalid_input', 'Select an image or video');
    if (!capability.acceptedTypes.includes(input.metadata.contentType) || input.metadata.byteSize > capability.maxBytes) throw new ProcessingError('unsupported_file', 'File format or size is not supported');
    if (request.operation === 'video-watermark') {
      if (input.metadata.kind !== 'video' || !input.metadata.durationSeconds || !input.metadata.fps) throw new ProcessingError('metadata_pending', 'Video inspection has not completed', 409);
      if (capability.maxDurationSeconds && input.metadata.durationSeconds > capability.maxDurationSeconds) throw new ProcessingError('duration_exceeded', 'Video exceeds the duration limit');
      if (capability.requiredFps && input.metadata.fps !== capability.requiredFps) throw new ProcessingError('unsupported_fps', 'Video frame rate is not supported');
    } else if (input.metadata.kind !== 'image') throw new ProcessingError('unsupported_file', 'Select an image');
    if (request.operation === 'image-refine' && Math.max(input.metadata.width, input.metadata.height) > 1920) throw new ProcessingError('refinement_resolution_limit', 'Refinement currently supports images up to 1920px; this version will not be resized', 409);
    if (['image-watermark', 'image-watermark-pro'].includes(request.operation) && Math.max(input.metadata.width, input.metadata.height) > 6000) throw new ProcessingError('image_resolution_limit', 'Prepare an image with a longest edge of at most 6000px before confirming the quote', 409);
    let mask: ProcessingArtifact | undefined;
    if (request.maskArtifactId) {
      mask = await this.owned(request.ownerId, request.maskArtifactId);
      if (mask.role !== 'mask' || mask.metadata.contentType !== 'image/png' || mask.metadata.width !== input.metadata.width || mask.metadata.height !== input.metadata.height) throw new ProcessingError('invalid_mask', 'Selection must match the input dimensions');
      if (!['image-refine', 'video-watermark'].includes(request.operation)) throw new ProcessingError('invalid_mask', 'This operation does not accept a selection');
    }
    if (request.operation === 'image-refine') {
      if (!request.parentJobId || !mask) throw new ProcessingError('refinement_requires_parent', 'Select a completed image and a nonempty region');
      const parent = await this.get(request.ownerId, request.parentJobId);
      if (parent.status !== 'READY' || parent.resultArtifactId !== input.id || parent.operation === 'image-watermark-pro' || !input.providerSessionId) throw new ProcessingError('refinement_unavailable', 'This version does not support refinement', 409);
    } else if (request.parentJobId) throw new ProcessingError('invalid_parent', 'Only refinement accepts a parent version');
    return { input, mask };
  }

  private fingerprint(request: QuoteRequest, input: ProcessingArtifact, mask?: ProcessingArtifact): string {
    return createHash('sha256').update(JSON.stringify({ operation: request.operation, parentJobId: request.parentJobId ?? null,
      input: { id: input.id, key: input.key, sha256: input.sha256, metadata: metadataSchema.parse(input.metadata), session: input.providerSessionId ?? null },
      mask: mask ? { id: mask.id, key: mask.key, sha256: mask.sha256, metadata: metadataSchema.parse(mask.metadata) } : null,
    })).digest('hex');
  }
  private requestHash(quote: ProcessingQuote): string {
    return createHash('sha256').update(`${quote.id}:${quote.fingerprint}:${quote.amount}:${quote.unit}:${quote.priceVersion}`).digest('hex');
  }
}
