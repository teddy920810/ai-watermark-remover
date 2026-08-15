import { getSecret } from 'astro:env/server';
import { betterAuth } from 'better-auth';

export const auth = betterAuth({
  baseURL: getSecret('BETTER_AUTH_URL'),
  secret: getSecret('BETTER_AUTH_SECRET'),
  socialProviders: {
    google: {
      clientId: getSecret('GOOGLE_CLIENT_ID') as string,
      clientSecret: getSecret('GOOGLE_CLIENT_SECRET') as string,
    },
  },
});

export function getSession(request: Request) {
  return auth.api.getSession({ headers: request.headers });
}
