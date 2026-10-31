-- Durable idempotency and recovery metadata. Image bytes and MVP job payloads
-- remain in private R2 and retain their existing one-day lifecycle.
CREATE TABLE IF NOT EXISTS processing_requests (
  job_id TEXT PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'live')),
  owner_id TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  input_key TEXT NOT NULL,
  mask_key TEXT,
  operation TEXT NOT NULL CHECK (operation IN ('watermark-removal', 'background-removal', 'object-removal')),
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '15 minutes'),
  UNIQUE (environment, owner_id, request_hash)
);
CREATE INDEX IF NOT EXISTS processing_requests_expired_idx ON processing_requests(environment, lease_expires_at)
  WHERE status = 'processing';
