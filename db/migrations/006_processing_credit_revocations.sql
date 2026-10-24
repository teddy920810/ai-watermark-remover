-- Preserve all existing grants and financial history; revocation is a new audited adjustment.
ALTER TABLE processing_credit_ledger DROP CONSTRAINT IF EXISTS processing_credit_ledger_reason_check;
ALTER TABLE processing_credit_ledger ADD CONSTRAINT processing_credit_ledger_reason_check
  CHECK (reason IN ('grant', 'reserve', 'settle', 'refund', 'revoke'));

-- 005's unnamed table check is replaced by an explicitly named compatible check.
ALTER TABLE processing_credit_ledger DROP CONSTRAINT IF EXISTS processing_credit_ledger_check;
ALTER TABLE processing_credit_ledger DROP CONSTRAINT IF EXISTS processing_credit_ledger_adjustment_check;
ALTER TABLE processing_credit_ledger ADD CONSTRAINT processing_credit_ledger_adjustment_check CHECK (
  (reason = 'grant' AND delta > 0 AND actor_id IS NOT NULL AND length(btrim(actor_id)) > 0)
  OR (reason = 'revoke' AND delta < 0 AND actor_id IS NOT NULL AND length(btrim(actor_id)) > 0)
  OR (reason = 'reserve' AND delta < 0)
  OR (reason = 'settle' AND delta = 0)
  OR (reason = 'refund' AND delta > 0)
);
