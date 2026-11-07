import { operationCatalog, type ProductOperation } from '../contracts/operation-catalog';

/** Approved business rules; activation, account migration and test budgets are separate. */
export const creditPolicy = {
  version: 'credits-20261104-v1',
  imageRates: { 'image-watermark': 100, 'image-watermark-pro': 300, 'image-refine': 100, 'background-removal': 10, 'object-removal': 10 },
  videoBlockSeconds: 2, videoBlockCredits: 100,
  rewards: { first: 100, daily: 100, cap: 300 },
  conversion: { purchase: 1, formalProcessing: 100, freeUse: 100 },
} as const;
export type CreditEnvironment = 'sandbox' | 'live';
export type WalletPhase = 'legacy' | 'draining' | 'unified';
export interface WalletState { phase: WalletPhase; epoch: number; environment: CreditEnvironment }
export interface CreditsConfiguration { admissionEnabled: boolean; environment: CreditEnvironment }

export function creditInteger(value: unknown, positive = false): number {
  const amount = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < (positive ? 1 : 0)) throw new Error('Invalid Credits amount');
  return amount;
}
export function creditCost(operation: ProductOperation, durationSeconds?: number): number {
  if (operation === 'video-watermark') {
    if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > operationCatalog['video-watermark'].capability.maxDurationSeconds) throw new Error('Invalid billable video duration');
    return creditInteger(creditPolicy.videoBlockCredits * Math.ceil(durationSeconds / creditPolicy.videoBlockSeconds), true);
  }
  if (!Object.hasOwn(creditPolicy.imageRates, operation)) throw new Error('Unknown processing operation');
  return creditPolicy.imageRates[operation];
}
export function rewardAmount(available: number, reserved: number): number {
  const held = creditInteger(available) + creditInteger(reserved);
  creditInteger(held);
  return Math.min(creditPolicy.rewards.daily, Math.max(0, creditPolicy.rewards.cap - held));
}
export function creditsConfiguration(source: Record<string, string | undefined>): CreditsConfiguration {
  const enabled = source.UNIVERSAL_CREDITS_ENABLED ?? 'false';
  const environment = source.PAYPAL_ENVIRONMENT ?? 'sandbox';
  if (!['true', 'false'].includes(enabled) || !['sandbox', 'live'].includes(environment)) throw new Error('Invalid Credits configuration');
  return { admissionEnabled: enabled === 'true', environment: environment as CreditEnvironment };
}
