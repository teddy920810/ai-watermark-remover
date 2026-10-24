import { describe, expect, it, vi } from 'vitest';
import { revokeProcessingCredits } from '../../../scripts/revoke-processing-credits.mjs';
describe('administrator revoke CLI', () => {
  const options = { email: 'person@example.com', amount: 30, reference: 'revoke-wrong-owner', actorId: 'admin', apply: false };
  it('previews an unused allocation withdrawal without a financial write or user ID in output', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [{ user_id: 'private-user-id' }] })) }; const store = { getBalance: vi.fn(async () => 30), revokeCredits: vi.fn() };
    const result = await revokeProcessingCredits(options, { pool, store });
    expect(result).toMatchObject({ mode: 'dry-run', amount: 30, balanceBefore: 30, balanceAfter: 0 }); expect(store.revokeCredits).not.toHaveBeenCalled(); expect(JSON.stringify(result)).not.toContain('private-user-id');
  });
  it('delegates apply/replay to the atomic store even when the current balance is zero', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [{ user_id: 'owner' }] })) }; const store = { getBalance: vi.fn(async () => 0), revokeCredits: vi.fn(async () => ({ revoked: false, balance: 0 })) };
    expect(await revokeProcessingCredits({ ...options, apply: true }, { pool, store })).toMatchObject({ revoked: false, balanceAfter: 0 }); expect(store.revokeCredits).toHaveBeenCalledWith('owner', 30, options.reference, 'admin');
    await expect(revokeProcessingCredits(options, { pool, store })).rejects.toThrow('available');
  });
});
