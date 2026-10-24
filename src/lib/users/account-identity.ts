export class AccountIdentityError extends Error {
  constructor(readonly code: 'identity_unverified' | 'identity_conflict' | 'identity_reauthentication_required') { super('Verified account identity could not be established. Sign in again or contact support.'); }
}
export interface AuthenticatedAccountUser { id: string; email: string; emailVerified: boolean }
export interface CanonicalAccountIdentity { id: string; email: string }
export interface AccountIdentityStore {
  resolveGoogleUser(user: Pick<AuthenticatedAccountUser, 'email' | 'emailVerified'>): Promise<string>;
  resolveAuthenticatedUser(user: AuthenticatedAccountUser): Promise<CanonicalAccountIdentity>;
}

/** The public Better Auth create hook runs before its adapter generates an ID.
 * https://better-auth.com/docs/concepts/database#database-hooks
 * mapProfileToUser IDs are discarded by handleOAuthUserInfo, and input:false
 * profile fields are deliberately filtered. Neither is an identity mechanism. */
export function createCanonicalUserCreateHook(identities: Pick<AccountIdentityStore, 'resolveGoogleUser'>) {
  return async (user: { email: string; emailVerified: boolean }) => ({ data: { id: await identities.resolveGoogleUser(user) } });
}

export function createCanonicalSessionReader<T extends { user: AuthenticatedAccountUser; session?: { userId?: string } }>(
  authenticate: (request: Request) => Promise<T | null | undefined>, identities: Pick<AccountIdentityStore, 'resolveAuthenticatedUser'>,
) {
  return async (request: Request): Promise<T | null> => {
    const session = await authenticate(request);
    if (!session?.user.id || session.user.emailVerified !== true) return null;
    try {
      const canonical = await identities.resolveAuthenticatedUser(session.user);
      return { ...session, user: { ...session.user, id: canonical.id, email: canonical.email }, ...(session.session ? { session: { ...session.session, userId: canonical.id } } : {}) };
    } catch (error) { if (error instanceof AccountIdentityError) return null; throw error; }
  };
}
