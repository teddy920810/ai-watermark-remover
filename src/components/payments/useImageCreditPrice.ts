import { useCallback, useEffect, useRef, useState } from 'react';
import { paymentRequest, type PaymentCatalog } from './payment-client';

type ImageOperation = 'watermark-removal' | 'background-removal' | 'object-removal';
export interface ImageCreditApproval { imageCreditConsent?: { imageCostVersion: string; maxImageCredits: number } }
interface DisplayedPrice { label: string; approval: ImageCreditApproval | null }
const unavailable = 'Image credit price unavailable. Retry before processing.';

export class ImagePriceChangedError extends Error {
  constructor() { super('The image credit price changed. Review the updated price and click again.'); }
}

export function imageCreditPrice(catalog: PaymentCatalog, operation: ImageOperation): DisplayedPrice {
  if (catalog.creditsEnabled === false) return { label: 'Uses your available free image balance. Failed operations return the reserved free use.', approval: {} };
  const amount = catalog.imageCosts?.[operation];
  const version = catalog.imageCostVersion;
  if (catalog.creditsEnabled !== true || typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000 || typeof version !== 'string' || !/^[a-zA-Z0-9:_-]{1,100}$/.test(version)) return { label: unavailable, approval: null };
  return {
    label: `1 free use first; otherwise ${amount.toLocaleString('en-US')} image credits. Failed operations return their original credit source.`,
    approval: { imageCreditConsent: { imageCostVersion: version, maxImageCredits: amount } },
  };
}

export function useImageCreditPrice(operation: ImageOperation) {
  const [price, setPrice] = useState<DisplayedPrice>({ label: 'Checking processing price…', approval: null });
  const [pending, setPending] = useState(true);
  const requestVersion = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    setPending(true);
    try {
      const catalog = await paymentRequest<PaymentCatalog>('/api/payments/catalog', { cache: 'no-store' });
      if (version === requestVersion.current) setPrice(imageCreditPrice(catalog, operation));
    } catch {
      if (version === requestVersion.current) setPrice({ label: unavailable, approval: null });
    } finally { if (version === requestVersion.current) setPending(false); }
  }, [operation]);
  useEffect(() => { void refresh(); return () => { requestVersion.current += 1; }; }, [refresh]);
  return { ...price, ready: !pending && price.approval !== null, pending, error: !pending && price.approval === null, refresh };
}
