/** Public product facts only. Prices remain in server price books; enabled status is runtime-owned. */
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];
export const operationCatalog = {
  'image-watermark': { protocol: 'v1', legacyOperation: 'watermark-removal', input: 'image', output: 'jpeg', executor: 'worker', priceSource: 'processing-quote-or-image-credit-prices', units: ['freeUses', 'purchasedImageCredits', 'processingCredits'], capability: { acceptedTypes: imageTypes, maxBytes: IMAGE_MAX_BYTES } },
  'image-watermark-pro': { protocol: 'v1', legacyOperation: null, input: 'image', output: 'jpeg', executor: 'worker', priceSource: 'processing-price-book', units: ['processingCredits'], capability: { acceptedTypes: imageTypes, maxBytes: IMAGE_MAX_BYTES } },
  'image-refine': { protocol: 'v1', legacyOperation: null, input: 'result-and-mask', output: 'jpeg-version', executor: 'worker', priceSource: 'processing-price-book', units: ['processingCredits'], capability: { acceptedTypes: ['image/jpeg'], maxBytes: 48 * 1024 * 1024 } },
  'video-watermark': { protocol: 'v1', legacyOperation: null, input: 'video-optional-mask', output: 'mp4', executor: 'worker', priceSource: 'processing-price-book', units: ['processingCredits'], capability: { acceptedTypes: ['video/mp4'], maxBytes: VIDEO_MAX_BYTES, maxDurationSeconds: 540, requiredFps: 24 } },
  'background-removal': { protocol: 'v1', legacyOperation: 'background-removal', input: 'image', output: 'rgba-png', executor: 'worker', priceSource: 'image-credit-prices', units: ['freeUses', 'purchasedImageCredits'], capability: { acceptedTypes: imageTypes, maxBytes: IMAGE_MAX_BYTES } },
  'object-removal': { protocol: 'v1', legacyOperation: 'object-removal', input: 'image-and-mask', output: 'png', executor: 'worker', priceSource: 'image-credit-prices', units: ['freeUses', 'purchasedImageCredits'], capability: { acceptedTypes: imageTypes, maxBytes: IMAGE_MAX_BYTES } },
} as const;
export type ProductOperation = keyof typeof operationCatalog;
export type DurableOperation = { [K in ProductOperation]: typeof operationCatalog[K]['protocol'] extends 'v1' ? K : never }[ProductOperation];
export type LegacyOperation = Exclude<typeof operationCatalog[ProductOperation]['legacyOperation'], null>;
export const durableOperationIds = Object.keys(operationCatalog).filter(id => operationCatalog[id as ProductOperation].protocol === 'v1') as [DurableOperation, ...DurableOperation[]];
export const legacyOperationIds = Object.values(operationCatalog).flatMap(value => value.legacyOperation ? [value.legacyOperation] : []) as [LegacyOperation, ...LegacyOperation[]];
export function durableCapabilities(enabled: boolean, reason?: string) {
  return durableOperationIds.map(operation => ({ operation, ...operationCatalog[operation].capability, acceptedTypes: [...operationCatalog[operation].capability.acceptedTypes], enabled, ...(!enabled && reason ? { reason } : {}) }));
}
