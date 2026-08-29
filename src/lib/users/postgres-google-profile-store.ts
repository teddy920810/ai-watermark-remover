import type { Pool } from 'pg';
import type { GoogleProfileStore, GoogleUserProfile } from './google-profile';

export class PostgresGoogleProfileStore implements GoogleProfileStore {
  constructor(private readonly pool: Pool) {}

  async save(profile: GoogleUserProfile): Promise<void> {
    await this.pool.query(`
      INSERT INTO google_user_profiles (
        google_subject,
        email,
        email_verified,
        name,
        given_name,
        family_name,
        picture_url,
        locale,
        hosted_domain
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (google_subject) DO UPDATE SET
        email = EXCLUDED.email,
        email_verified = EXCLUDED.email_verified,
        name = EXCLUDED.name,
        given_name = EXCLUDED.given_name,
        family_name = EXCLUDED.family_name,
        picture_url = EXCLUDED.picture_url,
        locale = EXCLUDED.locale,
        hosted_domain = EXCLUDED.hosted_domain,
        last_authorized_at = NOW()
    `, [
      profile.googleSubject,
      profile.email,
      profile.emailVerified,
      profile.name,
      profile.givenName,
      profile.familyName,
      profile.pictureUrl,
      profile.locale,
      profile.hostedDomain,
    ]);
  }
}
