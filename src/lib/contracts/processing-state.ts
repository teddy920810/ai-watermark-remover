/** Shared state names only; no storage, HTTP or execution dependencies. */
export type JobStatus = 'PREPARED' | 'QUEUED' | 'VALIDATING' | 'TRANSFERRING' | 'SUBMITTING' | 'PROCESSING' | 'SAVING' | 'SETTLING' | 'READY' | 'UNKNOWN' | 'FAILED' | 'REFUNDED' | 'EXPIRED';
export type ChargeStatus = 'reserved' | 'settled' | 'refunded';
export type CreditUnit = 'freeUses' | 'purchasedImageCredits' | 'processingCredits' | 'credits';
