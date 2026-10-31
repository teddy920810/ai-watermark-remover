import { describe, expect, it } from 'vitest';
import { createProcessingRuntime } from './processing-services';
import { MemoryFinance } from '../processing/test-fixtures';

describe('purchased image allowances in the workspace account response', () => {
  it('rejects a directly constructed Live wallet without a priced contract', () => {
    expect(() => createProcessingRuntime({ r2: { endpoint: 'https://unused.test', accessKeyId: 'fixture', secretAccessKey: 'fixture', bucket: 'fixture' }, databaseUrl: 'postgres://unused.test/fixture', providerMode: 'mock', enabled: false, imageCredits: { enabled: true, environment: 'live' } })).toThrow('operation prices');
  });
  it('exposes purchased image uses separately from free and administrator processing allowances', async () => {
    const finance = new MemoryFinance(); finance.imageBalances.set('user-1', 5);
    const runtime = createProcessingRuntime({
      r2: { endpoint: 'https://unused.test', accessKeyId: 'fixture', secretAccessKey: 'fixture', bucket: 'fixture' },
      databaseUrl: 'postgres://unused.test/fixture', providerMode: 'mock', enabled: false,
      imageCredits: { enabled: true, environment: 'live', costs: { 'watermark-removal': 100, 'background-removal': 10, 'object-removal': 10 }, priceVersion: '2026-10-31-v1' },
      dependencies: { finance, benefits: { async getSummary() { return { balance: 1, cap: 3, dailyReward: 1, checkedInToday: false }; } } },
    });
    try { expect(await runtime.balances('user-1')).toEqual({ freeUses: 1, purchasedImageCredits: 5, processingCredits: 100 }); }
    finally { await runtime.close(); }
  });
});
