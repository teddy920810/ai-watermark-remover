export interface ProviderInput {
  jobId: string;
  inputKey: string;
  maskKey?: string;
}

export type ProviderResult =
  | { status: 'completed'; resultKey: string }
  | { status: 'processing'; providerJobId: string };

export interface WatermarkProvider {
  remove(input: ProviderInput): Promise<ProviderResult>;
}
