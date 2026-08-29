import type { ProviderInput, ProviderResult } from './watermark-provider';

export interface BackgroundRemovalProvider {
  remove(input: ProviderInput): Promise<ProviderResult>;
}
