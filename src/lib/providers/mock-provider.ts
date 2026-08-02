import type { ProviderInput, ProviderResult, WatermarkProvider } from './watermark-provider';

interface ObjectCopier {
  copyObject(sourceKey: string, destinationKey: string): Promise<void>;
}

function extensionOf(key: string): string {
  const match = key.match(/\.(jpg|png|webp)$/i);
  if (!match) throw new Error('Input object has an unsupported extension');
  return match[1].toLowerCase();
}

export class MockWatermarkProvider implements WatermarkProvider {
  constructor(
    private readonly objects: ObjectCopier,
    private readonly delayMs = 0,
  ) {}

  async remove(input: ProviderInput): Promise<ProviderResult> {
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    const resultKey = `results/${input.jobId}.${extensionOf(input.inputKey)}`;
    await this.objects.copyObject(input.inputKey, resultKey);
    return { status: 'completed', resultKey };
  }
}
