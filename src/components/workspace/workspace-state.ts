export function canConfirmQuote(quote: { expiresAt: string } | null, busy: boolean, now = Date.now()) {
  return !!quote && !busy && Date.parse(quote.expiresAt) > now;
}
export function canSubmitConfirmation(quote: { expiresAt: string } | null, busy: boolean, insufficientBalance: boolean, uncertain: boolean, now = Date.now()) {
  return !!quote && !busy && (uncertain || !insufficientBalance && canConfirmQuote(quote, false, now));
}
const active = new Set(['PREPARED', 'QUEUED', 'VALIDATING', 'TRANSFERRING', 'SUBMITTING', 'PROCESSING', 'SAVING', 'SETTLING']);
export function jobIsActive(status: string) { return active.has(status); }
export function canRefineResult(job: { status: string; operation: string; result?: { canRefine?: boolean } }) {
  return job.status === 'READY' && job.operation !== 'video-watermark' && job.operation !== 'image-watermark-pro' && job.result?.canRefine === true;
}
export function processingLabel(status: string) {
  const labels: Record<string, string> = { PREPARED: 'Preparing your task', QUEUED: 'Waiting to start', VALIDATING: 'Checking your file', TRANSFERRING: 'Preparing the media', SUBMITTING: 'Starting removal', PROCESSING: 'Removing watermarks', SAVING: 'Saving your result', SETTLING: 'Finalizing your result', READY: 'Ready to review', UNKNOWN: 'Checking the processing confirmation', FAILED: 'Processing could not finish', REFUNDED: 'Processing failed · credits returned', EXPIRED: 'This result has expired' };
  return labels[status] ?? 'Checking task status';
}
export function creditLabel(amount: number, unit: string) { return unit === 'freeUses' ? `${amount} free image ${amount === 1 ? 'use' : 'uses'}` : `${amount} processing ${amount === 1 ? 'credit' : 'credits'}`; }
