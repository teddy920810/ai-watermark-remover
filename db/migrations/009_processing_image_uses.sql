-- Purchased image credits may fund normal image admissions. Administrator
-- processing-credit balances, historical admissions and ledgers are preserved.
ALTER TABLE processing_admissions DROP CONSTRAINT IF EXISTS processing_admissions_unit_check;
ALTER TABLE processing_admissions ADD CONSTRAINT processing_admissions_unit_check
  CHECK (unit IN ('freeUses', 'purchasedImageCredits', 'processingCredits'));
ALTER TABLE processing_admissions DROP CONSTRAINT IF EXISTS processing_admissions_image_use_amount_check;
