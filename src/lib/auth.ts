import { getSecret } from 'astro:env/server';
import { betterAuth } from 'better-auth';
import { Pool } from 'pg';
import { createGoogleProfileMapper } from './users/google-profile';
import { PostgresGoogleProfileStore } from './users/postgres-google-profile-store';
import { PostgresAccountIdentityStore } from './users/postgres-account-identity-store';
import { createCanonicalSessionReader, createCanonicalUserCreateHook } from './users/account-identity';

const identityPool = new Pool({
  connectionString: getSecret('DATABASE_URL'),
  max: 1,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 5_000,
});
const googleProfiles = new PostgresGoogleProfileStore(identityPool);
const accountIdentities = new PostgresAccountIdentityStore(identityPool);

export const auth = betterAuth({
  baseURL: getSecret('BETTER_AUTH_URL'),
  secret: getSecret('BETTER_AUTH_SECRET'),
  databaseHooks: { user: { create: { before: createCanonicalUserCreateHook(accountIdentities) } } },
  socialProviders: {
    google: {
      clientId: getSecret('GOOGLE_CLIENT_ID') as string,
      clientSecret: getSecret('GOOGLE_CLIENT_SECRET') as string,
      mapProfileToUser: createGoogleProfileMapper(googleProfiles, accountIdentities),
    },
  },
});

export const getSession = createCanonicalSessionReader((request) => auth.api.getSession({ headers: request.headers }), accountIdentities);
