/** Browser-safe HTTP response types. Private storage and execution records stay server-side. */
import type { JobStatus, ChargeStatus, CreditUnit } from './processing-state';
export type { JobStatus, ChargeStatus, CreditUnit } from './processing-state';
export type Operation = import('./operation-catalog').DurableOperation;

export interface MediaMetadata {
  kind: 'image' | 'video' | 'mask';
  contentType: string;
  byteSize: number;
  width: number;
  height: number;
  durationSeconds?: number;
  fps?: number;
  codec?: string;
  hasAudio?: boolean;
}

export interface Capability {
  operation: Operation;
  enabled: boolean;
  acceptedTypes: string[];
  maxBytes: number;
  maxDurationSeconds?: number;
  requiredFps?: number;
  reason?: string;
}

export interface PublicArtifact extends MediaMetadata {
  id: string;
  role: 'source' | 'mask' | 'result';
  metadata: MediaMetadata;
  format: string;
  expiresAt: string;
  previewUrl?: string;
  expired: boolean;
  canRefine?: boolean;
}

export interface PublicQuote {
  id: string;
  operation: Operation;
  inputArtifactId: string;
  maskArtifactId?: string;
  parentJobId?: string;
  amount: number;
  unit: CreditUnit;
  priceVersion: string;
  createdAt: string;
  expiresAt: string;
  isDemo: boolean;
  expectedOutput: {
    contentType: string;
    format: string;
    width: number;
    height: number;
    durationSeconds?: number;
    fps?: number;
    hasAudio?: boolean;
    transparent?: boolean;
    background?: string;
  };
}

export interface PublicJob {
  id: string;
  operation: Operation;
  status: JobStatus;
  chargeStatus: ChargeStatus;
  charge: { status: ChargeStatus; amount: number; unit: CreditUnit };
  amount: number;
  unit: CreditUnit;
  quote: { id: string; amount: number; unit: CreditUnit };
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  parentJobId?: string;
  progress?: number;
  input?: PublicArtifact;
  result?: PublicArtifact;
  errorCode?: string;
  error?: string;
  isDemo: boolean;
}

export interface PublicUpload {
  id: string;
  uploadId: string;
  kind: 'image' | 'video' | 'mask';
  status: 'created' | 'validating' | 'ready' | 'failed' | 'expired';
  createdAt: string;
  expiresAt: string;
  artifactId?: string;
  artifact?: PublicArtifact;
  previewUrl?: string;
  error?: string;
}

export interface PublicUploadTicket extends PublicUpload {
  uploadUrl: string;
  method: 'PUT';
  headers: { 'Content-Type': string };
}

export interface PublicDownload {
  url: string;
  downloadUrl: string;
  filename: string;
  expiresAt: string;
  artifactId: string;
}

export interface LegacyPublicBalances {
  walletMode?: 'legacy' | 'draining';
  freeUses: number;
  processingCredits: number;
  purchasedImageCredits?: number;
}
export type PublicBalances = LegacyPublicBalances | { walletMode: 'unified'; unit: 'credits'; credits: number; admissionEnabled: boolean };
