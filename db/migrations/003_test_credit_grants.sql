ALTER TABLE benefit_ledger
  DROP CONSTRAINT IF EXISTS benefit_ledger_reason_check;

ALTER TABLE benefit_ledger
  ADD CONSTRAINT benefit_ledger_reason_check
  CHECK (reason IN ('first_use', 'daily_checkin', 'job_reserve', 'job_refund', 'test_grant'));

ALTER TABLE benefit_ledger
  DROP CONSTRAINT IF EXISTS benefit_ledger_balance_after_check;

ALTER TABLE benefit_ledger
  ADD CONSTRAINT benefit_ledger_balance_after_check
  CHECK (balance_after BETWEEN 0 AND 3);
