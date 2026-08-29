export interface GoogleIdentityClaims {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  locale?: string;
  hd?: string;
}

export interface GoogleUserProfile {
  googleSubject: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  givenName: string | null;
  familyName: string | null;
  pictureUrl: string | null;
  locale: string | null;
  hostedDomain: string | null;
}

export interface GoogleProfileStore {
  save(profile: GoogleUserProfile): Promise<void>;
}

export function normalizeGoogleProfile(claims: GoogleIdentityClaims): GoogleUserProfile {
  return {
    googleSubject: claims.sub,
    email: claims.email.toLowerCase(),
    emailVerified: claims.email_verified,
    name: claims.name ?? null,
    givenName: claims.given_name ?? null,
    familyName: claims.family_name ?? null,
    pictureUrl: claims.picture ?? null,
    locale: claims.locale ?? null,
    hostedDomain: claims.hd ?? null,
  };
}

export function createGoogleProfileMapper(store: GoogleProfileStore) {
  return async (claims: GoogleIdentityClaims) => {
    await store.save(normalizeGoogleProfile(claims));
    return {};
  };
}
