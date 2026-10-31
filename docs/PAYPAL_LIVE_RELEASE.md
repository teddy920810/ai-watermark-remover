# PayPal image-credit release

This implementation extends the current App and stable account owners. The former Sandbox checkout was tested on an older source tree; its deployment is not a release artifact for this version. Live credentials and successful configuration checks are not evidence of a completed real transaction.

## Current release state — 2026-10-31

The account holder created the Live App and webhook and reported completed account review with no collection restriction. A read-only Live OAuth and webhook lookup accepted the credentials and confirmed the exact direct URL and five required events. No Live order, capture or refund was created by this preparation.

The account holder clarified that deployment should continue through the existing Vercel, Cloud Build and Cloud Run workflow; the earlier hold concerned a suspected new deployment setup. Reuse the existing projects, buckets, image repository and processing Job without adding infrastructure or upgrading plans. Limit the container build to ten minutes. The compatible Worker has a validated local seven-file bundle/context. Do not enable purchased credits against the old Worker. Production migration and artifact receipts, real Google login, Provider acceptance and real-money acceptance must be recorded separately. Local credentials stay ignored, and new checkout stays disabled until the applicable gates below pass. Real payment, refund and cost-bearing Provider acceptance remain account-holder-gated.

## Approved commercial scope

The account holder approved these packages on 2026-10-31:

| Package | USD | Purchased image credits |
| --- | ---: | ---: |
| Starter | 4.99 | 4,990 |
| Plus | 9.99 | 9,990 |
| Pro | 19.99 | 19,990 |

When a free image use is available, one eligible image task uses one free use. Otherwise, ordinary image watermark removal costs 100 purchased image credits; background removal and object removal each cost 10. Local editing, viewing and repeat downloads cost zero. Failure returns the originally reserved source and amount unless its purchase has been frozen or refunded.

Purchased image credits do not pay for PRO, refinement or video. Their administrator-funded `processingCredits` remain independent. The proposed future PRO price of 300 and video price of 100/second are planning inputs, not enabled payment features. A Pro package is a large balance package, not a PRO-mode unlock. Free-use counts and credit quantities are never summed.

## Runtime configuration

Keep Live credentials in an ignored local `.env.paypal-live.local` or the existing App project's server-side secrets. Never copy Sandbox credentials into Live or give the Worker PayPal credentials. Do not pull production secrets over a user's local configuration.

App-only private keys: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MERCHANT_ID`, `PAYPAL_WEBHOOK_ID`. Only the public Client ID may reach the official browser SDK.

Shared non-secret wallet configuration:

```dotenv
PAYPAL_ENVIRONMENT=live
PAYPAL_CREDITS_ENABLED=true
PAYPAL_IMAGE_COSTS_JSON={"watermark-removal":100,"background-removal":10,"object-removal":10}
PAYPAL_IMAGE_COST_VERSION=2026-10-31-v1
```

The App also needs the approved `PAYPAL_CATALOG_JSON` package array and `PAYPAL_CATALOG_VERSION=2026-10-31-image-credits-v1`. Both catalog and operation-cost versions preserve pricing evidence. Update the version whenever its configuration changes. A retry of an accepted task uses the original reservation, not the current operation price.

`PAYPAL_ENABLED` controls new orders. `PAYPAL_CREDITS_ENABLED` preserves purchased balances and fulfillment when new orders are paused. Live credit consumption requires explicit costs even if new checkout is paused; it never falls back to Sandbox's one-credit defaults. Opening Live checkout also requires `PAYPAL_LIVE_APPROVED=true`, the approved catalog/version, real processing Providers and a valid durable dispatch configuration. Pure configuration parsing does not verify IAM, Worker deployment or actual results.

The private `/app/credits` route is rendered on request by App so the first HTML contains the runtime catalog instead of an empty loading row. Both the page and catalog API use an explicit public projection; the full server configuration and credentials must never become island props. Browser initialization still confirms the catalog API before loading the PayPal SDK. Pending authentication uses a neutral status rather than briefly declaring the visitor signed out. Public SEO pages remain static. See [Astro request-time rendering](https://docs.astro.build/en/guides/on-demand-rendering/).

## Financial and account invariants

- Keep current `google_account_owners`, canonical `getSession`, authentication secret and legacy owner IDs. Do not import the obsolete Sandbox `wm_google_*` identity switch, merge by PayPal email, move old R2 keys or rewrite historic balances.
- Server-side Create and Capture determine the purchase. Grant only after confirmed COMPLETED payment and matching merchant, amount, currency and all order references. Browser approval cannot grant credits.
- Orders, captures, signed-event inbox and financial adjustments are idempotent. Keep each purchase's lot and append-only ledger after a refund.
- A paid reservation records its original quantity and FIFO purchase-lot allocations. Shortfall does not partially debit lots. Repeated requests do not reprice or reserve again.
- Refunds, reversals and disputes freeze only the affected purchase. A subsequent failed task cannot restore its frozen allocation. Administrator credits and free uses are independent. Used or partially refunded purchases enter review.
- Legacy image tools retain owner/input/operation/mask/environment deduplication and bounded recovery. The durable normal-image pipeline uses `purchasedImageCredits` for this wallet; `processingCredits` retains its existing meaning.
- Background and object-removal controls display free-use priority and the possible paid amount before submission. Paid admission requires the displayed price version and maximum credit amount. An expired or missing confirmation returns 409 before any paid debit; the browser preserves the file/mask, refreshes prices and requires a new deliberate click. Only an unadmitted coordination claim with no reservation or financial ledger entry may be released for this retry. Accepted tasks recover their original price without asking for another debit.
- PostgreSQL stores financial coordination; media and authoritative task state remain in private R2 with existing temporary retention.

## Webhook

Register the final direct HTTPS URL in the same Live App:

`https://www.watermarkgemini.com/api/payments/paypal/webhook`

Subscribe only to `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED`, `CUSTOMER.DISPUTE.CREATED`. Save this Live record's ID. Root-domain redirects and truncated paths are not equivalent to the direct listener. The configured URL was read back through Live APIs on 2026-10-31; actual delivery still needs transaction evidence.

## Release order and rollback

1. Complete targeted red/green tests, one local `release:verify`, independent financial review and required CI. Merge only the isolated release branch's reviewed changes. Preserve unrelated local edits.
2. Record the current App/Site deployments, Worker image digest/configuration and database migration state. Confirm a database recovery path. Do not create paid resources or change cloud plans.
3. Apply additive migrations `008_paypal_image_payments.sql`, `009_processing_image_uses.sql`, `010_processing_requests.sql` to the existing production database. Verify existing owner IDs, balances, free uses and admissions are preserved. Earlier 001–007 remain unchanged.
4. Build and update the existing Worker to the reviewed compatible artifact first. Preserve its service account, resource limits, Secret references and unrelated environment settings; change only the intended image and shared wallet configuration. Verify its deployed digest and exact configuration.
5. Publish the App with checkout still closed. Only after the Worker is compatible may Web credit support be enabled: it can generate the new unit even when new checkout is closed. The private checkout is `/app/credits`; its API and account routes remain in App. Terms/Privacy are independently built and released through Site.
6. Verify real Google login and the same canonical owner, public/noindex boundaries, actual Providers and authenticated operation smokes within the account holder's explicit cost budget. Open new checkout only when all applicable gates are met.
7. The account holder manually performs an agreed real payment and any refund. Verify Live Capture, verified callback HTTP 200, order status, exact grant and retained account ownership. Check original-order recovery and financial adjustments. A webhook resend 202 only means accepted; require actual delivery and unchanged ledger invariants.

To pause purchases, keep `PAYPAL_CREDITS_ENABLED=true` and correct Live credentials/costs while setting `PAYPAL_ENABLED=false`. Do not roll back a Worker to code that treats the new unit as administrator credits. Additive financial tables and ledger history are retained during rollback. Do not automatically refund, transfer balances or delete records as a rollback action.

## Evidence boundaries

Unit/network-fixture browser tests, migrated PGlite SQL, real PostgreSQL concurrency, deployment artifact checks, real OAuth, Provider processing and real payment/refund are separate gates. Record the first failure and repaired rerun separately. The opt-in PostgreSQL concurrency test runs only against a verified isolated Sandbox database and a newly created temporary schema; default CI skips it without its explicit test environment. Its cleanup verifies only that exact schema was removed.

The release remains pending until all applicable deployment and real transaction gates are recorded. No Simulator event substitutes for this integration's PayPal postback verification. No scheduled paid test or automatic real-money transaction is part of this release.

## Primary contracts

- [Standard Checkout](https://developer.paypal.com/studio/checkout/standard/integrate)
- [PayPal REST hosts](https://developer.paypal.com/api/make-api-requests)
- [Webhooks and signature verification](https://developer.paypal.com/api/rest/webhooks/rest/)
- [Webhook event names](https://developer.paypal.com/api/rest/webhooks/event-names/)
- [Cloud Run Job environment variables](https://docs.cloud.google.com/run/docs/configuring/jobs/environment-variables)
- [Cloud Run Job Secrets](https://docs.cloud.google.com/run/docs/configuring/jobs/secrets)
