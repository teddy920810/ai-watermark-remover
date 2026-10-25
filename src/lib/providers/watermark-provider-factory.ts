import type { LegacyWatermarkProvider, ProcessingWatermarkProvider, WatermarkProvider } from './watermark-provider';

/** Adapt the existing storage APIs without changing provider requests or recovery. */
export function createWatermarkProvider(legacy: LegacyWatermarkProvider, processing: ProcessingWatermarkProvider): WatermarkProvider {
  return {
    remove: (input) => legacy.remove(input),
    submit: (context) => processing.submit(context),
    poll: (context) => processing.poll(context),
  };
}
