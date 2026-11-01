import type { ProductOperation } from '../contracts/operation-catalog';

/** UI hints only. Server capabilities and quotes always decide actual admission. */
export interface MediaRecommendation { operation?: ProductOperation; unavailable?: boolean }
export function pageRecommendation(page?: { toolKind?: string; statusLabel?: string }): MediaRecommendation | undefined {
  if (!page) return undefined;
  const operation: ProductOperation = page.toolKind === 'background-remover' ? 'background-removal'
    : page.toolKind === 'object-remover' ? 'object-removal'
      : page.toolKind === 'video-watermark-remover' ? 'video-watermark' : 'image-watermark';
  return { operation, ...(page.statusLabel ? { unavailable: true } : {}) };
}
