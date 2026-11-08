/** Public product facts only. Prices remain in server price books; enabled status is runtime-owned. */
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];
/** Local operations have no allowance, quote, outbox, R2 or Provider execution. */
export const localOperationCatalog = {
  'gemini-image-free': { executor: 'browser', requiresAuthentication: true, charge: 0, output: 'png', capability: { acceptedTypes: imageTypes, maxBytes: IMAGE_MAX_BYTES, maxPixels: 40_000_000 } },
  'gemini-video-free': { executor: 'browser', requiresAuthentication: true, charge: 0, output: 'mp4', capability: { acceptedTypes: ['video/mp4'], maxBytes: VIDEO_MAX_BYTES } },
} as const;
// priceSource retains the legacy book contract; the credits unit uses credit-policy.
// Runtime account phase and admission configuration determine which unit is usable.
export const operationCatalog = {
  'image-watermark': { protocol: 'v1', imageCreditOperation: 'watermark-removal', input: 'image', output: 'jpeg', executor: 'worker', priceSource: 'processing-quote-or-image-credit-prices', units: ['freeUses', 'purchasedImageCredits', 'processingCredits', 'credits'], capability: { acceptedTypes: imageTypes, maxBytes: IMAGE_MAX_BYTES } },
  'image-watermark-pro': { protocol: 'v1', imageCreditOperation: null, input: 'image', output: 'jpeg', executor: 'worker', priceSource: 'processing-price-book', units: ['processingCredits', 'credits'], capability: { acceptedTypes: imageTypes, maxBytes: IMAGE_MAX_BYTES } },
  'image-refine': { protocol: 'v1', imageCreditOperation: null, input: 'result-and-mask', output: 'jpeg-version', executor: 'worker', priceSource: 'processing-price-book', units: ['processingCredits', 'credits'], capability: { acceptedTypes: ['image/jpeg'], maxBytes: 48 * 1024 * 1024 } },
  'video-watermark': { protocol: 'v1', imageCreditOperation: null, input: 'video-optional-mask', output: 'mp4', executor: 'worker', priceSource: 'processing-price-book', units: ['processingCredits', 'credits'], capability: { acceptedTypes: ['video/mp4'], maxBytes: VIDEO_MAX_BYTES, maxDurationSeconds: 540, requiredFps: 24 } },
  'background-removal': { protocol: 'v1', imageCreditOperation: 'background-removal', input: 'image', output: 'rgba-png', executor: 'worker', priceSource: 'image-credit-prices', units: ['freeUses', 'purchasedImageCredits', 'credits'], capability: { acceptedTypes: imageTypes, maxBytes: IMAGE_MAX_BYTES } },
  'object-removal': { protocol: 'v1', imageCreditOperation: 'object-removal', input: 'image-and-mask', output: 'png', executor: 'worker', priceSource: 'image-credit-prices', units: ['freeUses', 'purchasedImageCredits', 'credits'], capability: { acceptedTypes: imageTypes, maxBytes: IMAGE_MAX_BYTES } },
} as const;
export type ProductOperation = keyof typeof operationCatalog;
export type DurableOperation = { [K in ProductOperation]: typeof operationCatalog[K]['protocol'] extends 'v1' ? K : never }[ProductOperation];
export const durableOperationIds = Object.keys(operationCatalog).filter(id => operationCatalog[id as ProductOperation].protocol === 'v1') as [DurableOperation, ...DurableOperation[]];
export function durableCapabilities(enabled: boolean, reason?: string) {
  return durableOperationIds.map(operation => ({ operation, ...operationCatalog[operation].capability, acceptedTypes: [...operationCatalog[operation].capability.acceptedTypes], enabled, ...(!enabled && reason ? { reason } : {}) }));
}
