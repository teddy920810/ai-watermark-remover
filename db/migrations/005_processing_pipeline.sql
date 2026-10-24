-- Financial and delivery coordination only. Media and authoritative job state stay in private R2.
CREATE TABLE IF NOT EXISTS processing_accounts (
  owner_id TEXT PRIMARY KEY,
  available_credits BIGINT NOT NULL DEFAULT 0 CHECK (available_credits >= 0 AND available_credits <= 9007199254740991),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS processing_admissions (
  job_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  operation_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  amount BIGINT NOT NULL CHECK (amount > 0 AND amount <= 9007199254740991),
  unit TEXT NOT NULL CHECK (unit IN ('freeUses', 'processingCredits')),
  status TEXT NOT NULL CHECK (status IN ('reserved', 'settled', 'refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, operation_key),
  CHECK (unit <> 'freeUses' OR amount = 1)
);

CREATE TABLE IF NOT EXISTS processing_credit_ledger (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES processing_accounts(owner_id),
  delta BIGINT NOT NULL,
  balance_after BIGINT NOT NULL CHECK (balance_after >= 0 AND balance_after <= 9007199254740991),
  reason TEXT NOT NULL CHECK (reason IN ('grant', 'reserve', 'settle', 'refund')),
  reference_id TEXT NOT NULL,
  actor_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, reason, reference_id),
  CHECK (
    (reason = 'grant' AND delta > 0 AND actor_id IS NOT NULL AND length(btrim(actor_id)) > 0)
    OR (reason = 'reserve' AND delta < 0)
    OR (reason = 'settle' AND delta = 0)
    OR (reason = 'refund' AND delta > 0)
  )
);

CREATE TABLE IF NOT EXISTS processing_outbox (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('process', 'preflight')),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'dispatched', 'dead', 'completed')),
  due_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_owner TEXT,
  lease_until TIMESTAMPTZ,
  execution_ref TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, action)
);
CREATE INDEX IF NOT EXISTS processing_outbox_due_idx ON processing_outbox (due_at)
  WHERE state IN ('pending', 'dispatched');
CREATE INDEX IF NOT EXISTS processing_admissions_owner_idx ON processing_admissions (owner_id, created_at DESC);

-- Reward issuance remains capped by existing check-in logic. Refunds restore already-owned uses.
ALTER TABLE user_benefits DROP CONSTRAINT IF EXISTS user_benefits_balance_check;
ALTER TABLE user_benefits ADD CONSTRAINT user_benefits_balance_check CHECK (balance >= 0);
ALTER TABLE benefit_ledger DROP CONSTRAINT IF EXISTS benefit_ledger_balance_after_check;
ALTER TABLE benefit_ledger ADD CONSTRAINT benefit_ledger_balance_after_check CHECK (balance_after >= 0);
