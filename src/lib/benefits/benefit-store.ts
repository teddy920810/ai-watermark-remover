export const FREE_USE_CAP = 3;
export const DAILY_REWARD = 1;

export interface BenefitSummary {
  balance: number;
  cap: number;
  dailyReward: number;
  checkedInToday: boolean;
}

export interface CheckInResult extends BenefitSummary {
  granted: boolean;
  balanceFull: boolean;
}

export interface BenefitStore {
  getSummary(userId: string): Promise<BenefitSummary>;
  checkIn(userId: string): Promise<CheckInResult>;
  reserve(jobId: string, userId: string): Promise<void>;
  consume(jobId: string, userId: string): Promise<void>;
  refund(jobId: string, userId: string): Promise<void>;
}
