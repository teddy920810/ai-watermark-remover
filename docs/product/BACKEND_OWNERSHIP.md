# Backend assembly and transaction ownership

Status: P6.A local dependency checkpoint passed; verification and release state belong to the stage ledger. This does not imply production acceptance.

`ensureFreeBenefitAccount` receives the caller's PostgreSQL transaction client. It inserts the first free allowance and its ledger entry together; it never connects, begins, commits or releases a transaction. The Benefit store explicitly requests activity/email updates. Processing-only initialization does not touch those fields. Existing callers retain their transaction boundaries and lock order.

A workspace account response reuses `BenefitSummary.paidBalance` when present, including zero. An injected store that omits it still uses the financial store fallback. The next response reads a fresh summary: there is no balance cache across calls. Free uses, purchased image credits and administrator processing credits remain separate.

Account recovery passes its already queried candidates into `JobService.recoverUser`. The default direct call still queries candidates itself. Owner checks, the 20-candidate bound, lease/settlement checks, failure propagation and no-Provider-replay behavior remain in JobService.

The Web account and durable processing runtime borrow the process-owned `getWebDatabasePool` pool. It retains the existing three-connection Web bound and timeouts and rejects an attempt to reuse it for a different database. Closing a request/runtime does not close this shared pool. Payment and Better Auth resources retain their separate existing ownership and initialization.

Standalone Worker runtimes own their pool and S3 client unless explicit dependencies are supplied. `close()` closes owned resources once, destroys the owned client even if pool shutdown fails, and leaves injected resources open. Runtime construction, capability reads, preflight and dispatch do not construct an unused legacy Provider; the durable execution facet is created only when a job runs. Legacy JobService constructs only the requested operation's Provider and reuses that instance.

The canonical `WatermarkProvider` interface and derived facets remain intact. Old API requests and vendor request fields/headers/order are unchanged. Critical old-protocol configuration assertions now exercise the actual JobService consumer, rather than an unused legacy delegate inside the durable runtime. The primary Dewatermark contract is [the API reference](https://dewatermark.ai/api-document); this stage does not change its request protocol.

Local tests include migrated SQL on one PGlite connection, transaction rollback, first-use uniqueness, activity/identity behavior, fresh balance reads, recovery ownership, lazy facets and owned/borrowed cleanup. PGlite is not multi-connection PostgreSQL lock acceptance; external integration and real Provider gates remain separate.
