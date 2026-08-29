CREATE TABLE IF NOT EXISTS user_benefit_identities (
  user_id TEXT PRIMARY KEY REFERENCES user_benefits(user_id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_benefit_identities_email_idx
  ON user_benefit_identities (LOWER(email));
