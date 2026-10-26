import { z } from 'zod';
import type { ProviderCheckpoint, ProcessingWatermarkProvider } from '../providers/watermark-provider';
export type { ProviderCheckpoint, ProviderOutcome, ProcessingProviderContext } from '../providers/watermark-provider';

export const operationSchema = z.enum(['image-watermark', 'image-watermark-pro', 'image-refine', 'video-watermark']);
export type ProcessingOperation = z.infer<typeof operationSchema>;
export const amountSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const metadataSchema = z.object({
  kind: z.enum(['image', 'video']),
  contentType: z.string().min(1),
  byteSize: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  durationSeconds: z.number().finite().positive().optional(),
  fps: z.number().finite().positive().optional(),
  codec: z.string().optional(),
  hasAudio: z.boolean().optional(),
});
export type MediaMetadata = z.infer<typeof metadataSchema>;
export type ProcessingStatus = 'PREPARED' | 'QUEUED' | 'VALIDATING' | 'TRANSFERRING' | 'SUBMITTING' | 'PROCESSING' | 'SAVING' | 'SETTLING' | 'READY' | 'UNKNOWN' | 'FAILED' | 'REFUNDED' | 'EXPIRED';
export type ChargeStatus = 'reserved' | 'settled' | 'refunded';
export type CreditUnit = 'freeUses' | 'processingCredits';

/** Internal records contain private keys. HTTP responses must use a public projection. */
export interface ProcessingArtifact {
  id: string;
  ownerId: string;
  key: string;
  role: 'source' | 'mask' | 'result';
  sealed: boolean;
  sha256: string;
  metadata: MediaMetadata;
  createdAt: string;
  expiresAt: string;
  parentArtifactId?: string;
  providerSessionId?: string;
}

export interface OperationCapability {
  operation: ProcessingOperation;
  enabled: boolean;
  reason?: string;
  acceptedTypes: string[];
  maxBytes: number;
  maxDurationSeconds?: number;
  requiredFps?: number;
}

export interface ProcessingQuote {
  id: string;
  ownerId: string;
  operation: ProcessingOperation;
  inputArtifactId: string;
  maskArtifactId?: string;
  parentJobId?: string;
  amount: number;
  unit: CreditUnit;
  priceVersion: string;
  fingerprint: string;
  createdAt: string;
  expiresAt: string;
}

export interface ProcessingJob {
  id: string;
  ownerId: string;
  operation: ProcessingOperation;
  status: ProcessingStatus;
  quote: ProcessingQuote;
  inputArtifactId: string;
  maskArtifactId?: string;
  parentJobId?: string;
  resultArtifactId?: string;
  pendingResult?: ProcessingArtifact;
  progress?: number;
  chargeStatus: ChargeStatus;
  lease?: { owner: string; epoch: number; expiresAt: string };
  attempt?: { id: string; startedAt: string; checkpoint?: ProviderCheckpoint };
  unknownUntil?: string;
  /** Written before Cloud Run POST; a lost response must reuse this lookup nonce. */
  dispatch?: { id: string; startedAt: string; executionRef: string; terminal?: boolean };
  /** Monotonic submission fence, persisted before an idempotent financial refund. */
  refundIntent?: { reason: 'dispatch_timeout' | 'unknown_timeout'; requestedAt: string };
  error?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export interface VersionedJob { job: ProcessingJob; version: string }
export interface AttemptResult { jobId: string; attemptId: string; artifact: ProcessingArtifact; receivedAt: string }
export interface ProcessingJobStore {
  create(job: ProcessingJob): Promise<boolean>;
  get(id: string): Promise<VersionedJob | null>;
  compareAndSwap(id: string, expectedVersion: string, job: ProcessingJob): Promise<boolean>;
  recordAttemptResult(result: AttemptResult): Promise<void>;
  getAttemptResult(jobId: string, attemptId: string): Promise<AttemptResult | null>;
}

export interface ProcessingArtifactStore {
  get(id: string): Promise<ProcessingArtifact | null>;
  create(artifact: ProcessingArtifact): Promise<void>;
  /** Checks actual private R2 bytes, ownership, metadata and output semantics before settlement. */
  verifyStored(artifact: ProcessingArtifact): Promise<void>;
}
export interface ProcessingQuoteStore {
  get(id: string): Promise<ProcessingQuote | null>;
  create(quote: ProcessingQuote): Promise<void>;
}
export interface Admission {
  jobId: string;
  ownerId: string;
  idempotencyKey: string;
  requestHash: string;
  amount: number;
  unit: CreditUnit;
  status: ChargeStatus;
}
export interface ReserveRequest extends Omit<Admission, 'status'> { now: string }
export interface AdmissionHistoryCursor { createdAt: string; jobId: string }
export interface AdmissionHistoryPage { admissions: Admission[]; nextCursor?: AdmissionHistoryCursor }
export interface OutboxMessage {
  id: string;
  jobId: string;
  action: 'process' | 'reconcile' | 'preflight';
  ownerId?: string;
  attempts: number;
  executionRef?: string;
}
export interface ProcessingFinancialStore {
  getBalance(ownerId: string, unit?: CreditUnit): Promise<number>;
  findAdmission(ownerId: string, idempotencyKey: string): Promise<Admission | null>;
  getAdmission(jobId: string): Promise<Admission | null>;
  listAdmissionsForOwner(ownerId: string, limit?: number, before?: AdmissionHistoryCursor): Promise<AdmissionHistoryPage>;
  reserveAndEnqueue(request: ReserveRequest): Promise<{ admission: Admission; created: boolean }>;
  enqueuePreflight(ownerId: string, artifactId: string, now: string): Promise<void>;
  settle(jobId: string, ownerId: string): Promise<ChargeStatus>;
  refund(jobId: string, ownerId: string, reason: string): Promise<void>;
  claimDue(now: string, owner: string, limit?: number): Promise<OutboxMessage[]>;
  recordDispatch(id: string, owner: string, nextCheckAt: string, executionRef?: string): Promise<void>;
  retryDispatch(id: string, owner: string, nextCheckAt: string, error: string): Promise<void>;
  completeOutbox(jobId: string): Promise<void>;
}

/** Backwards-compatible name derived from the canonical WatermarkProvider. */
export type ProcessingProviderPort = ProcessingWatermarkProvider;

export interface ProcessingInspector {
  /** Non-billable: seals and inspects input. Must never invoke a paid Provider. */
  inspect(ownerId: string, artifactId: string): Promise<ProcessingArtifact>;
}
export interface ProcessingPriceBook {
  version: string;
  amount(operation: ProcessingOperation, input: MediaMetadata): number;
}

export class ProcessingError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
    this.name = 'ProcessingError';
  }
}

/** Throw only when the adapter knows no upstream processing was accepted. */
export class DefinitiveProviderError extends Error {}
