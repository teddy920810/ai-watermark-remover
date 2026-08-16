import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = process.env;

vi.mock('astro:env/server', () => ({
  getSecret: (name: string) => process.env[name],
}));

describe('Google authentication integration contract', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-thirty-two-characters',
      BETTER_AUTH_URL: 'http://localhost:3000',
      GOOGLE_CLIENT_ID: 'google-client-id.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'google-client-secret',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('starts Google OAuth with the registered callback path', async () => {
    const { auth } = await import('./auth');
    const response = await auth.handler(new Request('http://localhost:3000/api/auth/sign-in/social', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
      },
      body: JSON.stringify({ provider: 'google', callbackURL: 'http://localhost:3000/auth/popup' }),
    }));

    expect(response.status).toBe(200);
    const body = await response.json() as { url: string };
    const authorizationUrl = new URL(body.url);
    expect(authorizationUrl.origin).toBe('https://accounts.google.com');
    expect(authorizationUrl.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/auth/callback/google');
    expect(authorizationUrl.searchParams.get('scope')).toContain('openid');
  }, 10_000);
});
