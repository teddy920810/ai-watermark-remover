import type { CreditUnit, PublicBalances } from '../../lib/contracts/processing-public';

export function canConfirmQuote(quote: { expiresAt: string } | null, busy: boolean, now = Date.now()) {
  return !!quote && !busy && Date.parse(quote.expiresAt) > now;
}
export function canSubmitConfirmation(quote: { expiresAt: string } | null, busy: boolean, insufficientBalance: boolean, uncertain: boolean, now = Date.now()) {
  return !!quote && !busy && (uncertain || !insufficientBalance && canConfirmQuote(quote, false, now));
}
const active = new Set(['PREPARED', 'QUEUED', 'VALIDATING', 'TRANSFERRING', 'SUBMITTING', 'PROCESSING', 'SAVING', 'SETTLING']);
export function jobIsActive(status: string) { return active.has(status); }
export function canRefineResult(job: { status: string; operation: string; result?: { canRefine?: boolean } }) {
  return job.status === 'READY' && ['image-watermark', 'image-refine'].includes(job.operation) && job.result?.canRefine === true;
}
export function processingLabel(status: string) {
  const labels: Record<string, string> = { PREPARED: 'Preparing your task', QUEUED: 'Waiting to start', VALIDATING: 'Checking your file', TRANSFERRING: 'Preparing the media', SUBMITTING: 'Starting removal', PROCESSING: 'Removing watermarks', SAVING: 'Saving your result', SETTLING: 'Finalizing your result', READY: 'Ready to review', UNKNOWN: 'Checking the processing confirmation', FAILED: 'Processing could not finish', REFUNDED: 'Processing failed · credits returned', EXPIRED: 'This result has expired' };
  return labels[status] ?? 'Checking task status';
}
export function creditLabel(amount: number, unit: CreditUnit) {
  if (unit === 'credits') return `${amount} Credits`;
  if (unit === 'freeUses') return `${amount} free image ${amount === 1 ? 'use' : 'uses'}`;
  if (unit === 'purchasedImageCredits') return `${amount} image ${amount === 1 ? 'credit' : 'credits'}`;
  if (unit === 'processingCredits') return `${amount} processing ${amount === 1 ? 'credit' : 'credits'}`;
  throw new Error('Unknown allowance unit');
}
export function balanceForQuote(balance: PublicBalances | null | undefined, unit: CreditUnit): number | undefined {
  if (!balance) return undefined;
  if (unit === 'credits') return balance.walletMode === 'unified' ? balance.credits : undefined;
  if (balance.walletMode === 'unified') return undefined;
  switch (unit) {
    case 'freeUses': return balance.freeUses;
    case 'purchasedImageCredits': return balance.purchasedImageCredits ?? 0;
    case 'processingCredits': return balance.processingCredits;
    default: throw new Error('Unknown allowance unit');
  }
}
