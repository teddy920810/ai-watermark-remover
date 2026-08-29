import type { BackgroundRemovalProvider } from './background-removal-provider';
import type { ProviderInput, ProviderResult } from './watermark-provider';

interface CopyObjects {
  copyObject(sourceKey: string, destinationKey: string): Promise<void>;
}

export class MockBackgroundProvider implements BackgroundRemovalProvider {
  constructor(private readonly objects: CopyObjects, private readonly delayMs = 0) {}

  async remove(input: ProviderInput): Promise<ProviderResult> {
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    const resultKey = `results/background/${input.jobId}.png`;
    await this.objects.copyObject(input.inputKey, resultKey);
    return { status: 'completed', resultKey };
  }
}
