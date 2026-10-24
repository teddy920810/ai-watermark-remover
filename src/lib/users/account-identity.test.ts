import { describe, expect, it, vi } from 'vitest';
import { betterAuth } from 'better-auth';
import { AccountIdentityError, createCanonicalSessionReader, createCanonicalUserCreateHook } from './account-identity';

describe('canonical authenticated account identity', () => {
  it('normalizes old and new business sessions to one account without changing token or user profile fields', async () => {
    const identities = { resolveAuthenticatedUser: vi.fn(async () => ({ id: 'legacy-owner', email: 'person@gmail.com' })) };
    const raw = { user: { id: 'random-oauth-id', email: 'Person@gmail.com', emailVerified: true, name: 'Person' }, session: { userId: 'random-oauth-id', token: 'signed-session-token' } };
    const read = createCanonicalSessionReader(async () => raw, identities);
    expect(await read(new Request('https://www.example.test'))).toMatchObject({ user: { id: 'legacy-owner', email: 'person@gmail.com', name: 'Person' }, session: { userId: 'legacy-owner', token: 'signed-session-token' } });
    expect(raw.user.id).toBe('random-oauth-id'); expect(identities.resolveAuthenticatedUser).toHaveBeenCalledWith(raw.user);
  });
  it('does not resolve anonymous or unverified sessions and fails closed on an identity conflict', async () => {
    const identities = { resolveAuthenticatedUser: vi.fn(async () => { throw new AccountIdentityError('identity_conflict'); }) };
    expect(await createCanonicalSessionReader(async () => null, identities)(new Request('https://www.test'))).toBeNull();
    expect(await createCanonicalSessionReader(async () => ({ user: { id: 'x', email: 'person@gmail.com', emailVerified: false } }), identities)(new Request('https://www.test'))).toBeNull();
    expect(identities.resolveAuthenticatedUser).not.toHaveBeenCalled();
    expect(await createCanonicalSessionReader(async () => ({ user: { id: 'x', email: 'person@gmail.com', emailVerified: true } }), identities)(new Request('https://www.test'))).toBeNull();
  });
  it('sets the canonical ID through the installed SDK create hook across cold memory adapters', async () => {
    const identities = { resolveGoogleUser: vi.fn(async () => 'legacy-owner') };
    for (let index = 0; index < 2; index++) {
      const auth = betterAuth({ baseURL: 'https://www.example.test', secret: 'offline-auth-secret-with-at-least-thirty-two-characters', databaseHooks: { user: { create: { before: createCanonicalUserCreateHook(identities) } } } });
      const context = await auth.$context;
      const created = await context.internalAdapter.createOAuthUser({ name: 'Person', email: 'person@gmail.com', emailVerified: true }, { providerId: 'google', accountId: 'google-subject' });
      expect(created.user.id).toBe('legacy-owner'); expect(created.account.userId).toBe('legacy-owner');
    }
    expect(identities.resolveGoogleUser).toHaveBeenCalledTimes(2);
  });
});
