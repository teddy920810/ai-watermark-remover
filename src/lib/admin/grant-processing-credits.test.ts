import { describe, expect, it, vi } from 'vitest';
import { parseGrantArguments, grantProcessingCredits } from '../../../scripts/grant-processing-credits.mjs';
describe('administrator processing credits', () => {
  it('requires explicit new units and environment without converting the numeric grant again', async () => {
    const args = ['--email', 'person@example.com', '--credits', '100', '--reference', 'new-grant', '--actor', 'admin:operator', '--unit', 'credits', '--environment', 'live'];
    expect(parseGrantArguments(args)).toMatchObject({ amount: 100, unit: 'credits', environment: 'live' });
    const wallet = { environment: 'live', summary: vi.fn(async () => ({ phase: 'unified', credits: 300 })), grant: vi.fn(async () => ({ changed: true, balance: 400 })) };
    const store = { wallet, grantCredits: vi.fn() };
    const result = await grantProcessingCredits({ ...parseGrantArguments(args), apply: true }, { pool: { query: vi.fn(async () => ({ rows: [{ user_id: 'owner' }] })) }, store });
    expect(result).toMatchObject({ unit: 'credits', environment: 'live', amount: 100, balanceAfter: 400 });
    expect(wallet.grant).toHaveBeenCalledWith('owner', { amount: 100, reference: 'new-grant', actor: 'admin:operator' });
    expect(store.grantCredits).not.toHaveBeenCalled();
  });
  it('requires a safe email, positive integer, idempotency reference and explicit audit actor', () => {
    expect(parseGrantArguments(['--email', ' Person@Example.com ', '--credits', '12', '--reference', 'qa-2026', '--actor', 'admin:operator'])).toEqual({ email: 'person@example.com', amount: 12, reference: 'qa-2026', actorId: 'admin:operator', apply: false });
    for (const args of [[], ['--email', 'x@y.test', '--credits', '0'], ['--email', 'x@y.test', '--credits', '1', '--reference', 'qa', '--actor', 'admin', '--unknown', 'x']]) expect(() => parseGrantArguments(args)).toThrow();
  });
  it('resolves email with a parameterized existing identity query and keeps dry-run read-only', async () => {
    const query = vi.fn(async (_sql: string, _values: string[]) => ({ rows: [{ user_id: 'private-id' }] })); const store = { getBalance: vi.fn(async () => 4), grantCredits: vi.fn() };
    const result = await grantProcessingCredits({ email: 'person@example.com', amount: 12, reference: 'qa', actorId: 'admin', apply: false }, { pool: { query }, store });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('user_benefit_identities'), ['person@example.com']); expect(query.mock.calls[0][0]).not.toContain('person@example.com');
    expect(store.grantCredits).not.toHaveBeenCalled(); expect(result).toMatchObject({ mode: 'dry-run', balanceBefore: 4, balanceAfter: 16 }); expect(JSON.stringify(result)).not.toContain('private-id');
  });
  it('delegates atomic, idempotent financial writes to the existing store and rejects ambiguous identities', async () => {
    const query = vi.fn(async () => ({ rows: [{ user_id: 'owner' }] })); const store = { getBalance: vi.fn(async () => 0), grantCredits: vi.fn(async () => ({ granted: false, balance: 12 })) };
    const options = { email: 'person@example.com', amount: 12, reference: 'qa', actorId: 'admin', apply: true };
    expect(await grantProcessingCredits(options, { pool: { query }, store })).toMatchObject({ mode: 'applied', granted: false, balanceAfter: 12 }); expect(store.grantCredits).toHaveBeenCalledWith('owner', 12, 'qa', 'admin');
    query.mockResolvedValue({ rows: [] }); await expect(grantProcessingCredits(options, { pool: { query }, store })).rejects.toThrow('initialized');
    query.mockResolvedValue({ rows: [{ user_id: 'one' }, { user_id: 'two' }] }); await expect(grantProcessingCredits(options, { pool: { query }, store })).rejects.toThrow('initialized');
  });
});
