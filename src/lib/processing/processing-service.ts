import { createHash, randomUUID } from 'node:crypto';
import { admissionMatchesJob, amountSchema, metadataSchema, operationSchema, ProcessingError } from './contracts';
import type { AdmissionHistoryCursor, OperationCapability, ProcessingArtifact, ProcessingArtifactStore, ProcessingFinancialStore, ProcessingInspector, ProcessingJob, ProcessingJobStore, ProcessingOperation, ProcessingPriceBook, ProcessingQuote, ProcessingQuoteStore } from './contracts';
import { operationCatalog } from '../contracts/operation-catalog';
import type { ImageCreditCosts } from '../payments/image-credit-prices';
import { creditCost, creditPolicy } from '../credits/credit-policy';
import type { CreditsConfiguration, WalletState } from '../credits/credit-policy';

export interface QuoteRequest { ownerId: string; operation: ProcessingOperation; inputArtifactId: string; maskArtifactId?: string; parentJobId?: string }
export interface SubmitRequest { ownerId: string; quoteId: string; idempotencyKey: string; acceptCredits?: boolean }
export interface ProcessingServiceOptions {
  credits?: CreditsConfiguration;
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
  purchasedImageCreditsEnabled?: boolean;
  purchasedImageCreditCost?: number;
  imageCreditCosts?: Partial<ImageCreditCosts>;
  imageCreditPriceVersion?: string;
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
    const wallet = await this.wallet(request.ownerId);
    if (wallet?.phase === 'draining') throw new ProcessingError('wallet_draining', 'Your previous tasks are being reconciled before the account upgrade', 409);
    if (wallet?.phase === 'unified') {
      this.requireCreditsAdmission();
      const now = this.now();
      const quote: ProcessingQuote = { ...request, id: this.id(), unit: 'credits', amount: creditCost(request.operation, input.metadata.durationSeconds),
        environment: wallet.environment, walletEpoch: wallet.epoch, priceVersion: creditPolicy.version,
        fingerprint: this.fingerprint(request, input, mask), createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + (this.options.quoteTtlMs ?? 10 * 60_000)).toISOString() };
      await this.options.quotes.create(quote);
      return quote;
    }
    const imageCreditOperation = operationCatalog[request.operation].imageCreditOperation;
    const imageCost = amountSchema.parse((imageCreditOperation ? this.options.imageCreditCosts?.[imageCreditOperation] : undefined) ?? this.options.purchasedImageCreditCost ?? 1);
    let unit: ProcessingQuote['unit'] = 'processingCredits';
    if (['background-removal', 'object-removal'].includes(request.operation)) {
      unit = await this.options.finance.getBalance(request.ownerId, 'freeUses') >= 1 || !this.options.purchasedImageCreditsEnabled ? 'freeUses' : 'purchasedImageCredits';
    } else if (request.operation === 'image-watermark') {
      if (await this.options.finance.getBalance(request.ownerId, 'freeUses') >= 1) unit = 'freeUses';
      else if (await this.options.finance.getBalance(request.ownerId, 'purchasedImageCredits') >= imageCost) unit = 'purchasedImageCredits';
      else if (this.options.purchasedImageCreditsEnabled && await this.options.finance.getBalance(request.ownerId, 'processingCredits') < 1) unit = 'purchasedImageCredits';
    }
    const amount = unit === 'processingCredits' ? amountSchema.parse(this.options.prices.amount(request.operation, input.metadata)) : unit === 'purchasedImageCredits' ? imageCost : 1;
    const now = this.now();
    const quote: ProcessingQuote = {
      ...request, id: this.id(), amount, unit, priceVersion: this.priceVersion(unit, request.operation),
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
    const wallet = await this.wallet(request.ownerId);
    if (quote.unit === 'credits') {
      if (request.acceptCredits === false) throw new ProcessingError('wallet_upgraded', 'Refresh the workspace to confirm the Credits price', 409);
      this.requireCreditsAdmission();
      if (wallet?.phase !== 'unified' || quote.environment !== wallet.environment || quote.walletEpoch !== wallet.epoch) throw new ProcessingError('quote_changed', 'Your account changed; confirm a new quote', 409);
    } else if (wallet && wallet.phase !== 'legacy') throw new ProcessingError('quote_changed', 'Your account changed; confirm a new quote', 409);
    const { input, mask } = await this.validate(quote);
    if (this.fingerprint(quote, input, mask) !== quote.fingerprint || quote.priceVersion !== this.priceVersion(quote.unit, quote.operation)) throw new ProcessingError('quote_changed', 'Input or price changed; confirm a new quote', 409);
    const now = this.now().toISOString();
    const job: ProcessingJob = {
      id: this.id(), ownerId: request.ownerId, operation: quote.operation, status: 'PREPARED', quote,
      inputArtifactId: quote.inputArtifactId, ...(quote.maskArtifactId ? { maskArtifactId: quote.maskArtifactId } : {}),
      ...(quote.parentJobId ? { parentJobId: quote.parentJobId } : {}), chargeStatus: 'reserved', createdAt: now, updatedAt: now,
    };
    if (!await this.options.jobs.create(job)) throw new ProcessingError('job_conflict', 'Could not create processing operation', 409);
    const { admission } = await this.options.finance.reserveAndEnqueue({ jobId: job.id, ownerId: job.ownerId, idempotencyKey: request.idempotencyKey, requestHash, amount: quote.amount, unit: quote.unit, now,
      ...(quote.unit === 'credits' ? { environment: quote.environment, walletEpoch: quote.walletEpoch } : {}) });
    if (admission.jobId !== job.id) return this.get(request.ownerId, admission.jobId);
    const stored = await this.options.jobs.get(job.id);
    if (stored?.job.status === 'PREPARED') await this.options.jobs.compareAndSwap(job.id, stored.version, { ...stored.job, status: 'QUEUED', updatedAt: now });
    return this.get(request.ownerId, job.id);
  }

  async get(ownerId: string, jobId: string): Promise<ProcessingJob> {
    const stored = await this.options.jobs.get(jobId);
    if (!stored || stored.job.ownerId !== ownerId) throw new ProcessingError('not_found', 'Task not found', 404);
    if (stored.job.quote.unit === 'credits' && stored.job.quote.environment !== this.options.credits?.environment) throw new ProcessingError('not_found', 'Task not found', 404);
    const admission = await this.options.finance.getAdmission(jobId);
    if (!admissionMatchesJob(admission, stored.job)) throw new ProcessingError('not_found', 'Task not found', 404);
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
        return stored && admissionMatchesJob(entry, stored.job)
          && (stored.job.quote.unit !== 'credits' || stored.job.quote.environment === this.options.credits?.environment) ? stored.job : null;
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
      if (!['image-refine', 'video-watermark', 'object-removal'].includes(request.operation)) throw new ProcessingError('invalid_mask', 'This operation does not accept a selection');
    }
    if (request.operation === 'object-removal' && (!mask || mask.parentArtifactId !== input.id)) throw new ProcessingError('invalid_mask', 'Select an area on the current image');
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
    const original = `${quote.id}:${quote.fingerprint}:${quote.amount}:${quote.unit}:${quote.priceVersion}`;
    return createHash('sha256').update(quote.unit === 'credits' ? `credits-v1:${original}:${quote.environment}:${quote.walletEpoch}` : original).digest('hex');
  }
  private priceVersion(unit: ProcessingQuote['unit'], operation: ProcessingOperation) {
    if (unit === 'credits') return creditPolicy.version;
    return (unit === 'purchasedImageCredits' || ['background-removal', 'object-removal'].includes(operation) && this.options.purchasedImageCreditsEnabled) && this.options.imageCreditPriceVersion
      ? `${this.options.prices.version}:image:${this.options.imageCreditPriceVersion}` : this.options.prices.version;
  }
  private async wallet(ownerId: string): Promise<WalletState | undefined> {
    if (!this.options.credits) return undefined;
    if (!this.options.finance.getWalletState) throw new ProcessingError('wallet_unavailable', 'Account currency is temporarily unavailable', 503);
    const wallet = await this.options.finance.getWalletState(ownerId);
    if (!['legacy', 'draining', 'unified'].includes(wallet.phase) || wallet.environment !== this.options.credits.environment || !Number.isSafeInteger(wallet.epoch) || wallet.epoch < 0) throw new ProcessingError('wallet_unavailable', 'Account currency is temporarily unavailable', 503);
    return wallet;
  }
  private requireCreditsAdmission() {
    if (!this.options.credits?.admissionEnabled) throw new ProcessingError('credits_admission_closed', 'New Credits processing is temporarily unavailable. Your balance and existing tasks are retained.', 503);
  }
}
