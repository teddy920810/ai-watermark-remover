import type { ProviderInput, ProviderResult } from './watermark-provider';

export interface ObjectRemovalProvider {
  remove(input: ProviderInput & { maskKey?: string }): Promise<ProviderResult>;
}
