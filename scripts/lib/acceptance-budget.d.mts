export class AcceptanceBudget {
  constructor(file: string, limits?: { image: number; video: number }, options?: { requireCreditBudget?: boolean });
  reserve(kind: 'image' | 'video', purpose: string, quote?: { amount: number; unit: 'freeUses' | 'processingCredits' | 'purchasedImageCredits' }): Promise<string>;
  authorizeIncrease(limits: { image: number; video: number }, reason: string): Promise<void>;
  authorizeImageCredits(authorization: { amount: number; unit: 'processingCredits' | 'purchasedImageCredits'; additionalCalls: number; reason: string }): Promise<void>;
  finish(id: string, evidence: { status: 'passed' | 'failed' | 'unknown'; note?: string; [key: string]: unknown }): Promise<void>;
  summary(): Promise<{ used: { image: number; video: number }; remaining: { image: number; video: number }; records: Array<Record<string, unknown>>; imageCreditBudget?: { id: string; unit: 'processingCredits' | 'purchasedImageCredits'; limit: number; reserved: number; additionalCalls: number; firstRecordIndex: number; authorizedAt: string } }>;
}
