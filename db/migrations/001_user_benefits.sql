CREATE TABLE IF NOT EXISTS user_benefits (
  user_id TEXT PRIMARY KEY,
  balance SMALLINT NOT NULL DEFAULT 1 CHECK (balance BETWEEN 0 AND 3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_processed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS daily_checkins (
  user_id TEXT NOT NULL REFERENCES user_benefits(user_id) ON DELETE CASCADE,
  checkin_date DATE NOT NULL,
  reward SMALLINT NOT NULL DEFAULT 1 CHECK (reward = 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, checkin_date)
);

CREATE TABLE IF NOT EXISTS job_credit_reservations (
  job_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_benefits(user_id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'consumed', 'refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS job_credit_reservations_user_status_idx
  ON job_credit_reservations(user_id, status);

CREATE TABLE IF NOT EXISTS benefit_ledger (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_benefits(user_id) ON DELETE CASCADE,
  delta SMALLINT NOT NULL CHECK (delta IN (-1, 1)),
  balance_after SMALLINT NOT NULL CHECK (balance_after BETWEEN 0 AND 3),
  reason TEXT NOT NULL CHECK (reason IN ('first_use', 'daily_checkin', 'job_reserve', 'job_refund')),
  reference_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, reason, reference_id)
);
