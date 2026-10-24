# Processing credits and admission recovery

Implementation and release progress are tracked in [IMPLEMENTATION_TODO](product/IMPLEMENTATION_TODO.md). This document describes the implemented contracts; it does not assert that a migration, production grant or deployment has been completed.

The private R2 job record is authoritative for processing state. PostgreSQL contains account balances, the credit ledger, admission deduplication and durable delivery coordination. It does not contain provider sessions, result object keys or the job state machine.

Apply migrations in filename order. `005_processing_pipeline.sql` requires the existing benefit tables and preserves their first-use and check-in issuance rules. New `processing_accounts.available_credits` defaults to zero. There is no conversion from old free uses into new processing credits and no automatic grant on registration.

Normal image removal quotes use one existing `freeUses` when one is available; PRO, refinement and video use independently allocated `processingCredits`. Refunds restore the originally reserved unit and amount. Free-use balances may exceed the reward issuance cap after a refund; that does not increase the first-use or daily reward. Grant ledger rows require a positive amount and a nonempty administrator actor. Reserve rows are negative, settlement rows are zero and refund rows are positive.

Administrators run the existing server-side CLI with database credentials in their local environment. The target is resolved through `user_benefit_identities.email`, using a parameterized query. The user must first sign in and open the new workspace account allowance; authenticated API requests initialize this existing benefit identity with the session email. Google subject IDs are not substituted for application account IDs.

```sh
node --env-file-if-exists=.env.local scripts/grant-processing-credits.mjs --email person@example.com --credits 20 --reference qa-2026-10-24 --actor admin:operator
```

This command previews the allocation without a financial write. Add `--apply` to execute it. A repeated reference for the same account, amount and actor returns the existing outcome without adding credits. Reusing that reference with a different amount or actor is a conflict; use a new reference for a new allocation. The CLI delegates writes to `PostgresProcessingStore.grantCredits`, whose account lock, ledger write and balance update share one transaction. No public grant endpoint exists.

To withdraw an unused allocation, first apply `006_processing_credit_revocations.sql`, then use the matching server-side tool:

```sh
node --env-file-if-exists=.env.local scripts/revoke-processing-credits.mjs --email person@example.com --credits 20 --reference revoke-qa-2026-10-24 --actor admin:operator
```

This also defaults to a preview; add `--apply` for the transaction. Revocation subtracts only available `processingCredits` and appends a negative `revoke` ledger entry with the actor. It preserves every original grant, free-use balance and job reservation. Insufficient available credits are a conflict. An identical applied retry remains idempotent even if the first successful withdrawal reduced the balance to zero; a changed amount or actor with the same reference conflicts. Do not delete ledger rows or simulate a paid task to reverse an administrative allocation.

`PROCESSING_ENABLED` defaults to `false`. The web runtime also requires a configured durable execution trigger before admitting new work. It passes the unfiltered server environment to the Cloud Run trigger resolver, so workload-identity settings are not removed by the application environment schema. The independently configured worker can run an existing task directly; it does not need a web admission trigger. The deployment guide describes execution credentials and worker setup.

The browser must retain both `quoteId` and `idempotencyKey` after an uncertain submission response. A retry checks the existing admission before consulting the short-lived quote object, current availability or balance. It verifies the requested quote against the accepted job's sealed quote and returns the original task. This continues to work after quote expiry or cleanup. A different quote with the same operation key is rejected. A request that was never admitted still requires a current valid quote and sufficient balance.

For an uncertain provider submission, recovery checks the existing attempt and its receipt. It must never resubmit a charged supplier request merely because the first response was lost. An UNKNOWN operation remains financially frozen for at most 24 hours when reconciliation runs; after the site returns the reservation, a late result does not debit the account again. Durable dispatch and periodic reconciliation must remain operational for these deadlines to be enforced.

Temporary execution-dispatch failures stay pending. They retry after 60, 120, 240 and 480 seconds, then at most once per 900 seconds per message; a claimed delivery keeps its existing execution reference. Ten failed attempts do not automatically abandon an admitted task. The `dead` state is reserved for explicit operational isolation and is not reopened by a stale dispatcher. This recovery avoids another financial reservation or supplier resubmission.
