-- Purchased image credits are separate from administrator-funded
-- processing_accounts. Existing owners, balances and ledger history stay intact.
-- Financial records live independently of the one-day R2 object lifecycle.
CREATE TABLE IF NOT EXISTS payment_orders (
  id TEXT PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'live')),
  user_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  sku TEXT NOT NULL,
  catalog_version TEXT NOT NULL,
  credits INTEGER NOT NULL CHECK (credits BETWEEN 1 AND 1000000),
  amount_cents INTEGER NOT NULL CHECK (amount_cents BETWEEN 1 AND 100000000),
  currency TEXT NOT NULL CHECK (currency = 'USD'),
  paypal_order_id TEXT,
  capture_id TEXT,
  merchant_id TEXT,
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'fulfilled', 'review', 'refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (environment, user_id, request_key),
  UNIQUE (environment, paypal_order_id),
  UNIQUE (environment, capture_id)
);
CREATE INDEX IF NOT EXISTS payment_orders_user_created_idx ON payment_orders(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS paid_credit_lots (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES payment_orders(id),
  user_id TEXT NOT NULL REFERENCES user_benefits(user_id),
  granted INTEGER NOT NULL CHECK (granted > 0),
  available INTEGER NOT NULL CHECK (available >= 0 AND available <= granted),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS paid_credit_lots_spend_idx ON paid_credit_lots(user_id, status, created_at, id);

CREATE TABLE IF NOT EXISTS paid_credit_ledger (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_benefits(user_id),
  lot_id TEXT NOT NULL REFERENCES paid_credit_lots(id),
  delta INTEGER NOT NULL,
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  reason TEXT NOT NULL CHECK (reason IN ('purchase', 'job_reserve', 'job_refund', 'job_refund_frozen', 'adjustment')),
  reference_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lot_id, reason, reference_id)
);

ALTER TABLE job_credit_reservations ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'free'
  CHECK (source IN ('free', 'paid'));
ALTER TABLE job_credit_reservations ADD COLUMN IF NOT EXISTS lot_id TEXT REFERENCES paid_credit_lots(id);
ALTER TABLE job_credit_reservations ADD COLUMN IF NOT EXISTS amount BIGINT NOT NULL DEFAULT 1
  CHECK (amount > 0 AND amount <= 9007199254740991);
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'job_credit_reservations_source_lot_check'
      AND conrelid = 'job_credit_reservations'::regclass
  ) THEN
    ALTER TABLE job_credit_reservations ADD CONSTRAINT job_credit_reservations_source_lot_check
      CHECK ((source = 'free' AND lot_id IS NULL) OR (source = 'paid' AND lot_id IS NOT NULL));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'job_credit_reservations_free_amount_check'
      AND conrelid = 'job_credit_reservations'::regclass
  ) THEN
    ALTER TABLE job_credit_reservations ADD CONSTRAINT job_credit_reservations_free_amount_check
      CHECK (source <> 'free' OR amount = 1);
  END IF;
END $$;

-- A paid operation can span several purchases. lot_id above remains the first
-- lot for compatibility; this allocation table is authoritative for quantity.
CREATE TABLE IF NOT EXISTS paid_credit_allocations (
  job_id TEXT NOT NULL REFERENCES job_credit_reservations(job_id),
  lot_id TEXT NOT NULL REFERENCES paid_credit_lots(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  PRIMARY KEY (job_id, lot_id)
);
CREATE INDEX IF NOT EXISTS paid_credit_allocations_lot_idx ON paid_credit_allocations(lot_id,job_id);

-- Pre-upgrade paid reservations always reserved exactly one credit. Preserve
-- consumed/refunded history too; never reinterpret it at a new operation price.
INSERT INTO paid_credit_allocations(job_id,lot_id,amount)
SELECT r.job_id,r.lot_id,1 FROM job_credit_reservations r
WHERE r.source='paid' AND r.amount=1 AND r.lot_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM paid_credit_allocations a WHERE a.job_id=r.job_id)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS payment_events (
  id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'live')),
  event_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  PRIMARY KEY (environment,id)
);
CREATE INDEX IF NOT EXISTS payment_events_pending_idx ON payment_events(received_at) WHERE processed_at IS NULL;

-- No capture foreign key: a verified refund/reversal may arrive before fulfillment.
CREATE TABLE IF NOT EXISTS payment_adjustments (
  id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'live')),
  capture_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('refund', 'reversal', 'dispute')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0 AND (reason <> 'refund' OR amount_cents > 0)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (environment,id)
);
CREATE INDEX IF NOT EXISTS payment_adjustments_capture_idx ON payment_adjustments(capture_id);
