import { getSecret } from 'astro:env/server';
import { betterAuth } from 'better-auth';
import { Pool } from 'pg';
import { createGoogleProfileMapper } from './users/google-profile';
import { PostgresGoogleProfileStore } from './users/postgres-google-profile-store';

const googleProfiles = new PostgresGoogleProfileStore(new Pool({
  connectionString: getSecret('DATABASE_URL'),
  max: 1,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 5_000,
}));

export const auth = betterAuth({
  baseURL: getSecret('BETTER_AUTH_URL'),
  secret: getSecret('BETTER_AUTH_SECRET'),
  socialProviders: {
    google: {
      clientId: getSecret('GOOGLE_CLIENT_ID') as string,
      clientSecret: getSecret('GOOGLE_CLIENT_SECRET') as string,
      mapProfileToUser: createGoogleProfileMapper(googleProfiles),
    },
  },
});

export function getSession(request: Request) {
  return auth.api.getSession({ headers: request.headers });
}
