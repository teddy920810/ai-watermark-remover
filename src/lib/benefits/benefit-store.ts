import type { ImageCreditOperation } from '../payments/image-credit-wallet';

export const FREE_USE_CAP = 3;
export const DAILY_REWARD = 1;

export interface ImageCreditConsent {
  imageCostVersion: string;
  maxImageCredits: number;
}

export class ImagePriceChangedError extends Error {
  readonly code = 'image_price_changed';
  constructor() { super('Review the current image credit price and confirm again.'); }
}

export interface BenefitSummary {
  balance: number;
  cap: number;
  dailyReward: number;
  checkedInToday: boolean;
  /** Purchased image credits; never sum these with the free-use count. */
  paidBalance?: number;
}

export interface CheckInResult extends BenefitSummary {
  granted: boolean;
  balanceFull: boolean;
}

export interface BenefitStore {
  getSummary(userId: string, email?: string): Promise<BenefitSummary>;
  checkIn(userId: string, email?: string): Promise<CheckInResult>;
  reserve(jobId: string, userId: string, operation?: ImageCreditOperation, consent?: ImageCreditConsent): Promise<void>;
  consume(jobId: string, userId: string): Promise<void>;
  refund(jobId: string, userId: string): Promise<void>;
}
