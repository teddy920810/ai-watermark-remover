# Image operation migration

Status: background and object removal are locally implemented and verified in the durable pipeline; the stage ledger records the complete local gate and its first failures. No production migration or real Provider acceptance is implied.

| Operation | Current new-client admission | Allowance and artifact |
| --- | --- | --- |
| Standard / PRO / refinement | Existing durable coordinator | Existing operation-specific units, JPEG and supported result/session rules |
| Background | Same durable upload, quote, confirmation, task history and Worker | One free use first; otherwise the server's configured background image-credit cost. Never administrator processing credits. RGBA PNG at the input dimensions |
| Object | Same durable coordinator and Worker | One free use first, then its configured image-credit cost; source-bound opaque binary selection, original-size PNG and no administrator-credit fallback |

An anonymous file stays local. After sign-in, the durable coordinator prepares the owned source and obtains a quote without spending credits. Processing needs a deliberate click on the quoted action. This also applies after Google sign-in: a login request without a quote is not processing consent. Existing accepted old-protocol requests retain their approved prices and recovery records.

Quotes retain operation, source fingerprint, amount, unit and applicable image price version. A changed quote needs another click. Accepted requests keep their original quote and operation key through expiry, refresh and later price changes. An unknown submission or Provider result cannot be replaced by a fresh paid action. File pickers, drops and operation controls remain locked while that state is unresolved.

Background result review keeps the original/result comparison, transparent and named/custom background choices, and real PNG downloads. Color compositing happens on the device and does not create another processing task. An expired preview may request a fresh link once for the same task; manual link refresh remains available. Only Standard/refinement results with the supported session may offer refinement.

Web and Worker read the same original image Provider settings from `image-providers.ts`; admission still requires the durable processing gate and dispatcher. Existing model versions and request body/header shapes are retained. New background/object attempts pin their mock/Replicate identity in a private checkpoint so later configuration changes do not turn an accepted attempt into a different Provider call or change its demo label.

The Replicate adapter stores a private prediction receipt as soon as the identifier is known. Recovery retrieves that prediction; it does not submit again. A lost POST response without an identifier remains unknown. A synchronous billed result is retained before a lease checkpoint can reject a lost worker. Verified PNG bytes and an immutable result receipt use the existing owner, hash, dimensions, CAS, outbox, settlement, refund and late-result rules.

Object selection retains separate brush/lasso/eraser, twenty snapshots, clamped coordinates and the alpha-greater-than-ten binary export policy. A new source clears selection; a signed link refresh for that source does not. Redrawing invalidates its quote. The Worker verifies the source-bound sealed mask, preserves the original PNG/threshold normalization for the vendor request, retains normalized inputs in the existing private media namespaces, and keeps returned object PNG bytes unchanged.

The original [object model contract](https://replicate.com/allenhooo/lama/api), [background model contract](https://replicate.com/851-labs/background-remover/api) and [HTTP API](https://replicate.com/docs/reference/http) are the integration references. The existing JobService APIs keep accepting compatible old clients and continue querying/downloading previously accepted jobs. New background/object tasks use durable history; old financial/recovery records are not rewritten into new jobs. Old admission may be retired only after real operation acceptance and the client/task/result exit windows are established.

Local tests use simulated sessions, transport and result bytes. Before a later authorized production release, verify Web/Worker settings and the matching operation-level functional smoke once with an explicit budget. Public scheduled smoke remains read-only; mock checks are not real AI-effect, OAuth or paid-Provider acceptance.
