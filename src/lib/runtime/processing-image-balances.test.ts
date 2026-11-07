import { describe, expect, it, vi } from 'vitest';
import { createProcessingRuntime } from './processing-services';
import { MemoryFinance } from '../processing/test-fixtures';

describe('purchased image allowances in the workspace account response', () => {
  it('returns the single authoritative Credits balance without reading or adding legacy balances', async () => {
    const finance = new MemoryFinance();
    vi.spyOn(finance, 'getBalance').mockRejectedValue(new Error('Do not add legacy units'));
    const runtime = createProcessingRuntime({
      r2: { endpoint: 'https://unused.test', accessKeyId: 'fixture', secretAccessKey: 'fixture', bucket: 'fixture' },
      databaseUrl: 'postgres://unused.test/fixture', providerMode: 'mock', enabled: false,
      credits: { admissionEnabled: false, environment: 'sandbox' },
      dependencies: { finance, benefits: { async getSummary() { return { walletMode: 'unified' as const, unit: 'credits' as const, credits: 700,
        cap: 300, dailyReward: 100, rewardAvailable: 100, rewardReserved: 0, dailyRewardAvailable: 100, checkedInToday: false, epoch: 2 }; } } },
    });
    try { expect(await runtime.balances('user-1')).toEqual({ walletMode: 'unified', unit: 'credits', credits: 700, admissionEnabled: false }); }
    finally { await runtime.close(); }
  });
  it('reuses only this response summary, including zero, and reads fresh balances on the next call', async () => {
    const finance = new MemoryFinance();
    const read = vi.spyOn(finance, 'getBalance').mockImplementation(async (_owner, unit = 'processingCredits') => {
      if (unit !== 'processingCredits') throw new Error('Purchased balance was already read in this summary');
      return 100;
    });
    let paidBalance = 0;
    const getSummary = vi.fn(async () => ({ balance: 1, cap: 3, dailyReward: 1, checkedInToday: false, paidBalance }));
    const runtime = createProcessingRuntime({
      r2: { endpoint: 'https://unused.test', accessKeyId: 'fixture', secretAccessKey: 'fixture', bucket: 'fixture' },
      databaseUrl: 'postgres://unused.test/fixture', providerMode: 'mock', enabled: false,
      imageCredits: { enabled: true, environment: 'sandbox' }, dependencies: { finance, benefits: { getSummary } },
    });
    try {
      expect(await runtime.balances('user-1', 'person@example.test')).toEqual({ freeUses: 1, purchasedImageCredits: 0, processingCredits: 100 });
      paidBalance = 5;
      expect(await runtime.balances('user-1', 'person@example.test')).toEqual({ freeUses: 1, purchasedImageCredits: 5, processingCredits: 100 });
      expect(getSummary).toHaveBeenCalledTimes(2);
      expect(getSummary).toHaveBeenLastCalledWith('user-1', 'person@example.test');
      expect(read).toHaveBeenCalledTimes(2);
    } finally { await runtime.close(); }
  });
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
