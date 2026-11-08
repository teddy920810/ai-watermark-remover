import type { ProcessingArtifact, ProcessingJob } from '../processing/contracts';

export interface ProviderCheckpoint {
  provider?: 'mock' | 'replicate' | 'dewatermark';
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

/** The provider boundary for durable image/video operations. */
export interface WatermarkProvider {
  submit(context: ProcessingProviderContext): Promise<ProviderOutcome>;
  poll(context: ProcessingProviderContext): Promise<ProviderOutcome>;
}
