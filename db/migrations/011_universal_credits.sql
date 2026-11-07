-- Compatible, default-inactive schema only. No account conversion or issuance.
CREATE TABLE IF NOT EXISTS credit_accounts (
  owner_id TEXT NOT NULL REFERENCES user_benefits(user_id),
  environment TEXT NOT NULL CHECK (environment IN ('sandbox','live')),
  phase TEXT NOT NULL CHECK (phase IN ('legacy','draining','unified')),
  epoch BIGINT NOT NULL DEFAULT 0 CHECK (epoch BETWEEN 0 AND 9007199254740991),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_id,environment)
);
CREATE TABLE IF NOT EXISTS credit_lots (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('reward','admin','purchase')),
  source_id TEXT NOT NULL,
  origin_type TEXT NOT NULL,
  origin_id TEXT NOT NULL,
  actor_id TEXT,
  granted BIGINT NOT NULL CHECK (granted BETWEEN 1 AND 9007199254740991),
  available BIGINT NOT NULL CHECK (available BETWEEN 0 AND 9007199254740991 AND available<=granted),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','frozen')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (owner_id,environment) REFERENCES credit_accounts(owner_id,environment),
  UNIQUE (owner_id,environment,kind,source_id),
  CHECK (kind<>'admin' OR (actor_id IS NOT NULL AND length(btrim(actor_id))>0)),
  CHECK (status<>'frozen' OR available=0)
);
CREATE TABLE IF NOT EXISTS credit_reservations (
  job_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  amount BIGINT NOT NULL CHECK (amount BETWEEN 1 AND 9007199254740991),
  wallet_epoch BIGINT NOT NULL CHECK (wallet_epoch BETWEEN 1 AND 9007199254740991),
  status TEXT NOT NULL CHECK (status IN ('reserved','settled','refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (owner_id,environment) REFERENCES credit_accounts(owner_id,environment)
);
CREATE TABLE IF NOT EXISTS credit_allocations (
  job_id TEXT NOT NULL REFERENCES credit_reservations(job_id),
  lot_id TEXT NOT NULL REFERENCES credit_lots(id),
  amount BIGINT NOT NULL CHECK (amount BETWEEN 1 AND 9007199254740991),
  PRIMARY KEY (job_id,lot_id)
);
CREATE TABLE IF NOT EXISTS credit_ledger (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  lot_id TEXT NOT NULL REFERENCES credit_lots(id),
  delta BIGINT NOT NULL CHECK (delta BETWEEN -9007199254740991 AND 9007199254740991),
  balance_after BIGINT NOT NULL CHECK (balance_after BETWEEN 0 AND 9007199254740991),
  reason TEXT NOT NULL CHECK (reason IN ('reward','grant','purchase','reserve','settle','refund','refund_frozen','adjustment','revoke','migration_in')),
  reference_id TEXT NOT NULL,
  actor_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (owner_id,environment) REFERENCES credit_accounts(owner_id,environment),
  UNIQUE (owner_id,environment,lot_id,reason,reference_id),
  CHECK ((reason IN ('reward','grant','purchase','refund','migration_in') AND delta>0)
    OR (reason IN ('reserve','adjustment','revoke') AND delta<0)
    OR (reason IN ('settle','refund_frozen') AND delta=0))
);
CREATE TABLE IF NOT EXISTS credit_actions (
  owner_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('grant','revoke')),
  reference_id TEXT NOT NULL,
  lot_id TEXT NOT NULL REFERENCES credit_lots(id),
  amount BIGINT NOT NULL CHECK (amount BETWEEN 1 AND 9007199254740991),
  actor_id TEXT NOT NULL CHECK (length(btrim(actor_id))>0),
  PRIMARY KEY (owner_id,environment,action,reference_id),
  FOREIGN KEY (owner_id,environment) REFERENCES credit_accounts(owner_id,environment)
);
CREATE TABLE IF NOT EXISTS credit_checkins (
  owner_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  day DATE NOT NULL,
  amount INTEGER NOT NULL CHECK (amount BETWEEN 1 AND 100),
  PRIMARY KEY (owner_id,environment,day),
  FOREIGN KEY (owner_id,environment) REFERENCES credit_accounts(owner_id,environment)
);
-- A legacy source can be converted only once, even into a different environment.
CREATE TABLE IF NOT EXISTS credit_source_conversions (
  source_type TEXT NOT NULL CHECK (source_type IN ('free','processing','purchase')),
  source_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  lot_id TEXT REFERENCES credit_lots(id),
  old_amount BIGINT NOT NULL CHECK (old_amount BETWEEN 0 AND 9007199254740991),
  new_amount BIGINT NOT NULL CHECK (new_amount BETWEEN 0 AND 9007199254740991),
  rule_version TEXT NOT NULL,
  digest TEXT NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY (source_type,source_id),
  FOREIGN KEY (owner_id,environment) REFERENCES credit_accounts(owner_id,environment)
);
CREATE INDEX IF NOT EXISTS credit_lots_owner_idx ON credit_lots(owner_id,environment,status,created_at,id);
CREATE INDEX IF NOT EXISTS credit_allocations_lot_idx ON credit_allocations(lot_id,job_id);
CREATE TABLE IF NOT EXISTS credit_migration_runs (
  owner_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('draining','unified')),
  actor_id TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  proof_digest TEXT NOT NULL CHECK (proof_digest ~ '^[a-f0-9]{64}$'),
  proof_history JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(proof_history)='array'),
  digest TEXT CHECK (digest ~ '^[a-f0-9]{64}$'),
  snapshot JSONB,
  PRIMARY KEY(owner_id,environment),
  FOREIGN KEY(owner_id,environment) REFERENCES credit_accounts(owner_id,environment)
);
ALTER TABLE benefit_ledger DROP CONSTRAINT IF EXISTS benefit_ledger_reason_check;
ALTER TABLE benefit_ledger ADD CONSTRAINT benefit_ledger_reason_check CHECK (reason IN ('first_use','daily_checkin','job_reserve','job_refund','test_grant','migration_out'));
ALTER TABLE benefit_ledger DROP CONSTRAINT IF EXISTS benefit_ledger_delta_check;
ALTER TABLE benefit_ledger ADD CONSTRAINT benefit_ledger_delta_check CHECK ((reason='migration_out' AND delta<0) OR (reason<>'migration_out' AND delta IN (-1,1)));
ALTER TABLE processing_credit_ledger DROP CONSTRAINT IF EXISTS processing_credit_ledger_reason_check;
ALTER TABLE processing_credit_ledger ADD CONSTRAINT processing_credit_ledger_reason_check CHECK (reason IN ('grant','reserve','settle','refund','revoke','migration_out'));
ALTER TABLE processing_credit_ledger DROP CONSTRAINT IF EXISTS processing_credit_ledger_adjustment_check;
ALTER TABLE processing_credit_ledger ADD CONSTRAINT processing_credit_ledger_adjustment_check CHECK (
  (reason='grant' AND delta>0 AND actor_id IS NOT NULL AND length(btrim(actor_id))>0)
  OR (reason IN ('revoke','migration_out') AND delta<0 AND actor_id IS NOT NULL AND length(btrim(actor_id))>0)
  OR (reason='reserve' AND delta<0) OR (reason='settle' AND delta=0) OR (reason='refund' AND delta>0));
ALTER TABLE paid_credit_ledger DROP CONSTRAINT IF EXISTS paid_credit_ledger_reason_check;
ALTER TABLE paid_credit_ledger ADD CONSTRAINT paid_credit_ledger_reason_check CHECK (reason IN ('purchase','job_reserve','job_refund','job_refund_frozen','adjustment','migration_out'));
ALTER TABLE processing_admissions DROP CONSTRAINT IF EXISTS processing_admissions_unit_check;
ALTER TABLE processing_admissions ADD CONSTRAINT processing_admissions_unit_check CHECK (unit IN ('freeUses','processingCredits','purchasedImageCredits','credits'));
ALTER TABLE processing_admissions ADD COLUMN IF NOT EXISTS environment TEXT CHECK (environment IN ('sandbox','live'));
ALTER TABLE processing_admissions ADD COLUMN IF NOT EXISTS wallet_epoch BIGINT CHECK (wallet_epoch BETWEEN 1 AND 9007199254740991);
ALTER TABLE processing_admissions DROP CONSTRAINT IF EXISTS processing_admissions_credit_context_check;
ALTER TABLE processing_admissions ADD CONSTRAINT processing_admissions_credit_context_check CHECK (unit<>'credits' OR (environment IS NOT NULL AND wallet_epoch IS NOT NULL));
