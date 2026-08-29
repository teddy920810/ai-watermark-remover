import { describe, expect, it, vi } from 'vitest';
import { createGoogleProfileMapper, normalizeGoogleProfile } from './google-profile';

describe('Google profile persistence mapping', () => {
  it('normalizes every standard identity claim without retaining token claims', () => {
    const claims = {
      sub: 'google-user-123',
      email: 'Person@Example.com',
      email_verified: true,
      name: 'Example Person',
      given_name: 'Example',
      family_name: 'Person',
      picture: 'https://lh3.googleusercontent.com/avatar',
      locale: 'zh-CN',
      hd: 'example.com',
      aud: 'client-id',
      iss: 'https://accounts.google.com',
      iat: 1,
      exp: 2,
    };

    expect(normalizeGoogleProfile(claims)).toEqual({
      googleSubject: 'google-user-123',
      email: 'person@example.com',
      emailVerified: true,
      name: 'Example Person',
      givenName: 'Example',
      familyName: 'Person',
      pictureUrl: 'https://lh3.googleusercontent.com/avatar',
      locale: 'zh-CN',
      hostedDomain: 'example.com',
    });
  });

  it('accepts Google profiles that omit optional claims', () => {
    expect(normalizeGoogleProfile({
      sub: 'google-user-123',
      email: 'person@example.com',
      email_verified: false,
    })).toEqual({
      googleSubject: 'google-user-123',
      email: 'person@example.com',
      emailVerified: false,
      name: null,
      givenName: null,
      familyName: null,
      pictureUrl: null,
      locale: null,
      hostedDomain: null,
    });
  });

  it('persists the normalized profile and leaves Better Auth core mapping unchanged', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const mapper = createGoogleProfileMapper({ save });
    const profile = { sub: 'google-user-123', email: 'person@example.com', email_verified: true };

    await expect(mapper(profile)).resolves.toEqual({});
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      googleSubject: 'google-user-123',
      email: 'person@example.com',
      emailVerified: true,
    }));
  });
});
