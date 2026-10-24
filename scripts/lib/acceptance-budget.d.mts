export class AcceptanceBudget {
  constructor(file: string, limits?: { image: number; video: number });
  reserve(kind: 'image' | 'video', purpose: string): Promise<string>;
  authorizeIncrease(limits: { image: number; video: number }, reason: string): Promise<void>;
  finish(id: string, evidence: { status: 'passed' | 'failed' | 'unknown'; note?: string; [key: string]: unknown }): Promise<void>;
  summary(): Promise<{ used: { image: number; video: number }; remaining: { image: number; video: number }; records: Array<Record<string, unknown>> }>;
}
