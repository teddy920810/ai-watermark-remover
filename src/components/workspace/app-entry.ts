import { operationCatalog, type ProductOperation } from '../../lib/contracts/operation-catalog';
import type { MediaKind } from '../../lib/client/media-drafts';
import type { MediaRecommendation } from '../../lib/client/media-recommendation';

export const operationLabels: Record<ProductOperation, string> = {
  'image-watermark': 'Standard watermark removal',
  'image-watermark-pro': 'PRO watermark removal',
  'image-refine': 'Refine current result',
  'background-removal': 'Remove background',
  'object-removal': 'Remove object',
  'video-watermark': 'Video watermark removal',
};
export function appOperationPath(operation: ProductOperation) { return `/app?operation=${encodeURIComponent(operation)}`; }
export function identityHasChanged(previous: string | undefined, current: string | undefined) { return Boolean(previous && previous !== current); }
export function resolveAppEntry({ kind, requested, hasJob = false, source, recommendation }: { kind: MediaKind; requested?: string | null; hasJob?: boolean; source?: string; recommendation?: MediaRecommendation }) {
  const fallback: ProductOperation = kind === 'video' ? 'video-watermark' : 'image-watermark';
  if (hasJob) return { operation: fallback };
  if (!requested && recommendation?.unavailable) return { operation: fallback, notice: 'The operation advertised on that page is not available. Your file is ready in a supported workspace; choose an available operation before processing.' };
  const recommendations: Record<string, ProductOperation> = { 'remove-background': 'background-removal', 'remove-object': 'object-removal', 'video-watermark-remover': 'video-watermark' };
  const selected = requested || recommendation?.operation || recommendations[source?.replace(/^\/+|\/+$/g, '') ?? ''];
  if (!selected) return { operation: fallback };
  if (!Object.hasOwn(operationCatalog, selected)) return { operation: fallback, notice: 'This operation is not available. Choose one of the supported operations.' };
  const operation = selected as ProductOperation;
  if ((operation === 'video-watermark') !== (kind === 'video')) return { operation: fallback, notice: `Your file is ${kind === 'video' ? 'a video' : 'an image'}. We opened the compatible workspace. Choose an operation before processing.` };
  if (operation === 'image-refine') return { operation: fallback, notice: 'Open a completed supported result and choose Refine remaining marks to refine it.' };
  return { operation };
}
