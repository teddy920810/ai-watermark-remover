import type { ProcessingArtifact, ProcessingJob } from '../processing/contracts';

export interface ProviderInput {
  jobId: string;
  inputKey: string;
  maskKey?: string;
}

export type ProviderResult =
  | { status: 'completed'; resultKey: string }
  | { status: 'processing'; providerJobId: string };

export interface ProviderCheckpoint {
  providerJobId?: string;
  sessionId?: string;
  stage?: string;
}

export type ProviderOutcome =
  | { status: 'completed'; artifact: ProcessingArtifact }
  | { status: 'processing'; checkpoint: ProviderCheckpoint; progress?: number }
  | { status: 'failed'; message: string };

export interface ProcessingProviderContext {
  job: ProcessingJob;
  input: ProcessingArtifact;
  mask?: ProcessingArtifact;
  checkpoint(value: ProviderCheckpoint): Promise<void>;
  heartbeat(): Promise<void>;
}

/** The shared boundary for legacy removal and durable image/video operations. */
export interface WatermarkProvider {
  remove(input: ProviderInput): Promise<ProviderResult>;
  submit(context: ProcessingProviderContext): Promise<ProviderOutcome>;
  poll(context: ProcessingProviderContext): Promise<ProviderOutcome>;
}

/** Compatibility facets always derive from the canonical provider contract. */
export type LegacyWatermarkProvider = Pick<WatermarkProvider, 'remove'>;
export type ProcessingWatermarkProvider = Pick<WatermarkProvider, 'submit' | 'poll'>;
