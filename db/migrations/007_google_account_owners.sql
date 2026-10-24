-- Stable provider ownership; no balances, ledgers, R2 keys or legacy owner IDs move.
CREATE TABLE IF NOT EXISTS google_account_owners (
  google_subject TEXT PRIMARY KEY REFERENCES google_user_profiles(google_subject),
  owner_id TEXT NOT NULL UNIQUE,
  verified_email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS google_account_owners_email_idx ON google_account_owners (LOWER(verified_email));

-- Only a unique verified, persisted Google profile can associate an existing
-- email identity. Ambiguous profiles remain unbound for explicit investigation.
WITH verified_profiles AS (
  SELECT google_subject, email, COUNT(*) OVER (PARTITION BY LOWER(email)) AS profile_count
  FROM google_user_profiles WHERE email_verified = TRUE
)
INSERT INTO google_account_owners (google_subject, owner_id, verified_email)
SELECT profile.google_subject, identity.user_id, LOWER(profile.email)
FROM verified_profiles profile
JOIN user_benefit_identities identity ON LOWER(identity.email) = LOWER(profile.email)
WHERE profile.profile_count = 1
ON CONFLICT DO NOTHING;
