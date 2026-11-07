# Processing credits and admission recovery

This document owns the implemented Credits contracts. Version-specific migration, deployment and acceptance evidence is recorded in [release readiness](product/RELEASE_READINESS.md); the [refactor ledger](product/REFACTOR_LEDGER.md) retains historical implementation evidence.

## Universal Credits: repository default off, explicit account cutover

`UNIVERSAL_CREDITS_ENABLED` defaults to `false`; a deployed environment's activation is a separate release fact. The implementation adds a fourth explicit unit, `credits`; it does not reinterpret any old amount. The shared price authority is `src/lib/credits/credit-policy.ts`; operation identifiers and limits remain in `operation-catalog.ts`. New and upgraded accounts use that one spendable currency for every operation and every eligible source:

| Operation | New Credits |
| --- | ---: |
| Ordinary image watermark removal | 100 |
| PRO watermark removal | 300 |
| Brush refinement | 100 |
| Video watermark removal | `100 * ceil(serverDurationSeconds / 2)` |
| Background removal | 10 |
| Object removal | 10 |

Video uses the sealed server duration: 3 seconds costs 200, 5 seconds costs 300. Quotes seal the rule version, environment and wallet epoch. Reservations and refunds use the original amount and source allocations, including after price changes or quote cleanup. Legacy quotes, jobs, orders, units and amounts are not rewritten.

The new first reward is 100 Credits. One UTC daily check-in issues up to 100; only available plus reserved **reward** Credits count toward the 300 issuance cap. Purchased and administrator Credits do not block a reward. A refund or historical entitlement may exceed the cap and is never clipped. Small-tool reward purchasing power increases by the approved factor of ten. The package catalog and money amounts remain unchanged; the Credits release does not reopen purchases.

The SQL wallet is source-aware: reward, administrator and purchase lots share spendable units but retain origin, actor, allocations and immutable ledger rows. Consumption uses reward, then administrator, then purchase lots, with FIFO within each source kind. Insufficient funds cause no partial debit. Revocation can remove only the unreserved remainder of the explicitly named administrator grant. Frozen purchases cannot be revived by a failed-task refund. Captures and adjustments keep the original owner, environment, money and order references.

### Compatible rollout and pause

1. Review and apply additive `011_universal_credits.sql` before any compatible App/Worker code that reads its tables. The candidate and local SQL fixtures do not prove a real migration has run.
2. Deploy compatible Worker and recovery code, then App, with `UNIVERSAL_CREDITS_ENABLED=false` and purchases still closed. Verify actual versions separately.
3. Review per-owner source evidence, drain old admission, and wait for all old reservations, UNKNOWN/SAVING/SETTLING tasks and durable claims to reconcile. Old reads, settlement, refunds and original-order captures remain recoverable.
4. Preview again after draining; apply only its exact reviewed digest in one owner-locked transaction. New lots and old migration-out ledger rows commit together. Old purchases convert 1:1; verified formal processing grants and free uses convert 100:1. Unverified processing origins defer the account; a total balance alone is not sufficient proof.
5. After real database, compatible Worker and account migration gates, an explicitly authorized bounded activation window may enable new admission for browser and functional acceptance. Use the existing aggregate ledger, keep purchases closed and pause new admission if acceptance fails. Do not declare the launch accepted until these real gates pass. New accounts receive the new first reward only when explicitly enabled. An existing legacy account never upgrades merely by signing in.

An account progresses `legacy → draining → unified`; the epoch fences old confirmations. The shared transaction-scoped owner fence precedes benefit/account/lot locks, including payment fulfillment. Global source-conversion keys prevent a free or processing source from being converted again into another environment. The browser sends `X-Credits-Contract: credits-v1`; an old client cannot submit a new Credits charge. Pause by disabling new admission, retain all tables and financial history, and keep compatible settlement/refund/read code. Never roll back to a binary that treats an unknown unit as processingCredits.

### Explicit migration and administration

`scripts/migrate-universal-credits.mjs` is import-safe and defaults to a read-only preview. It accepts only an explicit `CREDITS_*DATABASE_URL` selection, never a generic `DATABASE_URL` fallback. Supply `--owner`, `--environment`, `--proof`, `--actor`, `--reference`; `--action drain --apply` establishes draining. Review the fresh preview before `--action apply --apply --expected-digest <digest>`. The proof identifies verified free rights and each formal grant's original ledger ID and remaining quantity. If an old refund changes quantities during drain, an explicit repeated drain with the same actor/reference records the revised proof in append-only history; apply accepts only the latest proof and exact snapshot. A completed identical apply is idempotent. This documentation is not permission to run any command against an account.

The existing administrator tools retain their old default unit. For new Credits, add `--unit credits --environment sandbox` (or an explicitly approved live environment) and pass the amount directly in new Credits; do not multiply it again. Revoke additionally requires `--grant-reference` naming the original grant. Both default to preview; only `--apply` writes. Legacy QA/free grant commands refuse draining, unified or already converted sources. No public grant endpoint is added.

### Bounded real acceptance remains a separate gate

The processing runner accepts `--expected-unit credits` only with the **existing** aggregate ledger, exact `--credit-budget-id`, `--credit-scope-id` and `--credit-environment`. Its reviewed initialized scope binds origin, environment, owner digest, session digest and allowed operations before any authenticated network request. No missing ledger or ready scope is created automatically. All accounts share that ledger: gross issuance plus unknown issuance reservations ≤2,000; gross spend plus unknown spend reservations ≤2,000; at most six Provider invocation slots. Issuance intents use unique source references; reserve the first reward before account initialization within an explicitly reviewed, session-bound scope. Confirmation records issuance but never marks the scope initialized; processing remains closed until the operator reviews the initialized account. No automatic signup, grant or check-in is performed by the processing runner.

Reserve a slot and full quote before the sole submission. Failed, refunded and unknown attempts retain their slot and uncertain spend; successful confirmation records the exact one-quote debit. Re-running does not reclaim totals or silently retry a POST. New-currency authenticated production smoke delegates to this same runner; scheduled/public smoke remains public-only. The local implementation window uses only fixtures and injected fake services: real issuance, database/account activity and Provider calls remain zero. Real PostgreSQL concurrency is opt-in under the existing isolated-sandbox guard; PGlite SQL tests and mocked browser downloads are not evidence of real contention or Provider effects. Manual PayPal payment and cash-refund acceptance is deferred by user request.

## Legacy currency and recovery contract

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
