export class AcceptanceBudget {
  constructor(file: string, limits?: { image: number; video: number }, options?: { requireCreditBudget?: boolean });
  reserve(kind: 'image' | 'video', purpose: string, quote?: { amount: number; unit: 'freeUses' | 'processingCredits' | 'purchasedImageCredits' }): Promise<string>;
  authorizeIncrease(limits: { image: number; video: number }, reason: string): Promise<void>;
  authorizeImageCredits(authorization: { amount: number; unit: 'processingCredits' | 'purchasedImageCredits'; additionalCalls: number; reason: string }): Promise<void>;
  finish(id: string, evidence: { status: 'passed' | 'failed' | 'unknown'; note?: string; [key: string]: unknown }): Promise<void>;
  summary(): Promise<{ used: { image: number; video: number }; remaining: { image: number; video: number }; records: Array<Record<string, unknown>>; imageCreditBudget?: { id: string; unit: 'processingCredits' | 'purchasedImageCredits'; limit: number; reserved: number; additionalCalls: number; firstRecordIndex: number; authorizedAt: string } }>;
}

export class CreditsAcceptanceBudget {
  constructor(file: string, context: { budgetId: string; scopeId: string; session: string; origin: string; environment: 'sandbox' | 'live'; operation: string });
  authorize(unit: string, amount: number): ReturnType<CreditsAcceptanceBudget['summary']>;
  reserve(kind: 'image' | 'video', purpose: string, quote: { amount: number; unit: 'credits' | 'freeUses' | 'processingCredits' | 'purchasedImageCredits'; operation: string }): Promise<string>;
  reserveIssuance(input: { source: string; amount: number; unit?: 'credits' | 'freeUses' | 'processingCredits' | 'purchasedImageCredits' }): Promise<string>;
  finishIssuance(id: string, evidence: { amount: number }): Promise<void>;
  finish(id: string, evidence: { status: 'passed' | 'failed' | 'unknown'; creditsBefore?: number; creditsAfter?: number }): Promise<void>;
  summary(): Promise<{ grossIssued: number; issuanceReservedUnknown: number; grossSpent: number; spendReservedUnknown: number; realProviderInvocationsConsumed: number; events: Array<Record<string, unknown>>; remaining: { image: number; video: number } }>;
}

export function authorizeFunctionalAcceptance(options: Record<string, unknown>, environment: Record<string, string | undefined>): Promise<{
  budget: CreditsAcceptanceBudget; summary: Awaited<ReturnType<CreditsAcceptanceBudget['summary']>>;
  operation: string; unit: 'credits' | 'freeUses' | 'processingCredits' | 'purchasedImageCredits'; amount: number; origin: string; session: string;
}>;
