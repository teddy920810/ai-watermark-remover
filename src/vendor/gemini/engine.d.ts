export interface ImagePixels<TBuffer extends ArrayBufferLike = ArrayBufferLike> { width: number; height: number; data: Uint8ClampedArray<TBuffer> }
export function removeWatermarkFromImageDataSync(data: ImagePixels): { imageData: ImagePixels<ArrayBuffer>; meta: { applied: boolean; bestEffort?: boolean } };
export function getEmbeddedAlphaMap(size: number | string): Float32Array;
export function getVideoAlphaMap(size: number): Float32Array;
export function inspectGeminiVideoFile(file: Blob): Promise<{ width: number; height: number; duration: number; frameRate: number }>;
export function removeGeminiVideoWatermark(file: Blob, options: { onProgress?(progress: { phase: string; progress?: number }): void; yieldToMainThread?(): Promise<void> }): Promise<{ blob: Blob; audioCopied: boolean; audioSkipReason?: string; processedFrames: number; skippedFrames: number }>;
