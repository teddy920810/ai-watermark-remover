CREATE TABLE IF NOT EXISTS google_user_profiles (
  google_subject TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  email_verified BOOLEAN NOT NULL,
  name TEXT,
  given_name TEXT,
  family_name TEXT,
  picture_url TEXT,
  locale TEXT,
  hosted_domain TEXT,
  first_authorized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_authorized_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS google_user_profiles_email_idx
  ON google_user_profiles (LOWER(email));
