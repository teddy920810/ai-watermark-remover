# Backend assembly and transaction ownership

Status: P6.A local dependency checkpoint passed; verification and release state belong to the stage ledger. This does not imply production acceptance.

`ensureFreeBenefitAccount` receives the caller's PostgreSQL transaction client. It inserts the first free allowance and its ledger entry together; it never connects, begins, commits or releases a transaction. The Benefit store explicitly requests activity/email updates. Processing-only initialization does not touch those fields. Existing callers retain their transaction boundaries and lock order.

A workspace account response reuses `BenefitSummary.paidBalance` when present, including zero. An injected store that omits it still uses the financial store fallback. The next response reads a fresh summary: there is no balance cache across calls. Free uses, purchased image credits and administrator processing credits remain separate.

The account service owns only database-backed summaries and check-in. It no longer queries the retired JobService recovery queue or initializes media Providers. Current processing recovery belongs to the v1 financial/outbox and Worker coordinator.

The Web account and durable processing runtime borrow the process-owned `getWebDatabasePool` pool. It retains the existing three-connection Web bound and timeouts and rejects an attempt to reuse it for a different database. Closing a request/runtime does not close this shared pool. Payment and Better Auth resources retain their separate existing ownership and initialization.

Standalone Worker runtimes own their pool and S3 client unless explicit dependencies are supplied. `close()` closes owned resources once, destroys the owned client even if pool shutdown fails, and leaves injected resources open. Runtime construction, capability reads, preflight and dispatch do not construct an unused legacy Provider; the durable execution facet is created only when a job runs.

The canonical `WatermarkProvider` interface contains only submit/poll. The old remove facet, composition adapter and old Provider implementations are retired locally. Vendor requests, headers, model versions and receipt/recovery behavior of the current adapters are unchanged. The primary Dewatermark contract is [the API reference](https://dewatermark.ai/api-document).

Local tests include migrated SQL on one PGlite connection, transaction rollback, first-use uniqueness, activity/identity behavior, fresh balance reads, current recovery ownership, lazy Providers and owned/borrowed cleanup. PGlite is not multi-connection PostgreSQL lock acceptance; external integration and real Provider gates remain separate.
