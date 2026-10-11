# Milestone 6.2C — supported automatic receipt polling

Date: 2026-10-11. Repository: `yusufsaafa/etsy-reading-os`. Branch: `codex/ui-ux-design-lock`. Starting HEAD: `fc0c7c027d2c083c21cf5aec48dce51ee8b1de8f`; verified clean and in ancestry before editing.

## Outcome and evidence labels

**IMPLEMENTED:** a dedicated, durable, bounded OAuth receipt polling path. Sellers connect the application once; no receipt ID, developer account, API key or webhook secret is part of normal Orders operation. Receipt-ID recovery moved to private diagnostics. The existing controlled intake engine is reused.

**TESTED:** synthetic HTTP responses and disposable PGlite databases; exact results appear below. No live Etsy request, grant change, migration against a persistent database, AI dispatch, customer PDF or delivery occurred.

**NOT VERIFIED:** actual Reading OS application approval, receipt access, deployed worker, real-shop automatic ingestion, production PostgreSQL concurrency and browser acceptance.

**BLOCKED:** implementation of a presumed application-wide webhook transport. The official sources consulted establish application subscriptions but do not explicitly specify coverage of every third-party OAuth-authorized shop or a per-shop registration mechanism. This implementation uses the documented polling fallback requested in the milestone. It is not a claim that Etsy lacks webhooks.

The definition of done is conditional on operator deployment and real authorized acceptance. This report does not declare automatic intake active in a deployed environment.

## 1. Official webhook contract findings

Authority: [Etsy webhook documentation](https://developers.etsy.com/documentation/essentials/webhooks/), checked 2026-10-11.

Documented events: `order.paid`, `order.canceled`, `order.shipped`, `order.delivered`. Flat JSON carries `event_type`, `resource_url`, `shop_id`. Verification uses raw bytes, `webhook-id`, `webhook-timestamp`, `webhook-signature`; signed content is ID, timestamp and body joined with periods. Decode the secret after removing `whsec_`; calculate HMAC-SHA256, Base64-encode and compare signature entries. The example rejects clock differences over 300 seconds. Retry intervals are immediate, 5 seconds, 5 minutes, 30 minutes, 2 hours, 5 hours, 10 hours and another 10 hours. Portal recovery is documented; exactly-once delivery is not promised. OAuth with suitable scopes and a public POST callback are prerequisites. Subscriptions are managed in the application's portal, not seller settings. Additional per-shop subscription or universal shop coverage is not established by this page. Signature entry version syntax and delayed-retry timestamp renewal need clarification before implementation.

## 2. Supported events and current naming

The event names above are recorded for future webhook work, not accepted by an endpoint in this change. Etsy shipment/delivery events do not prove delivery of a Reading OS digital reading.

Additional primary sources:

- [Official personal webhook availability announcement](https://github.com/etsy/open-api/discussions/1537): personal application support was announced February 17, 2026; current documentation includes commercial and personal applications.
- [Official event-name transition](https://github.com/etsy/open-api/discussions/1535): lowercase `order.paid` replaced the earlier uppercase name.
- [Official payload clarification](https://github.com/etsy/open-api/discussions/1564): the earlier nested payload is obsolete; the current envelope is flat.

No invented subscription API, signature header or event field was added.

## 3–5. Application configuration, OAuth and commercial access

[Etsy application access documentation](https://developers.etsy.com/documentation/) distinguishes own-shop Seller Apps from Personal Apps and commercial access. Commercial access permits scoped OAuth endpoints for consenting third-party sellers at broader scale, with manual approval. Reading OS must own that application and its credentials; a seller's OAuth consent does not register a webhook subscription. Current webhook documentation offers an application Developer Portal workflow, with no documented per-shop registration API found in this investigation. Operator access and configuration have not been inspected or changed.

Automatic polling requires the existing `transactions_r` grant and existing server OAuth/vault configuration. No extra scope or seller credential form is introduced. Connect Etsy remains the existing authorization flow.

## 6–7. Receiver and signature verification

**BLOCKED / NOT IMPLEMENTED:** no public webhook receiver, signature implementation or webhook acknowledgement path was created while third-party delivery coverage remains unresolved. There is no endpoint that accepts unauthenticated events or invents generic HMAC semantics. Webhook-specific signature tests are not applicable to this polling implementation; no synthetic signature result is represented as verified Etsy interoperability.

The earlier repository was available at `/Users/yusufsafakilic/Codex/medium-reading-platform`. Its `etsy-webhook-signature.service.ts` and `etsy-webhook.controller.ts` were read as references. They verify a signature and process `order.paid` during the request, with permissive field aliases. They do not establish Reading OS application eligibility, durable processing or tenant authorization. No code was copied.

## 8. Tenant routing and OAuth lifecycle

`completeOAuth()` in `src/modules/etsy/connection-service.ts` initializes `etsy_automatic_intake` in the same Store-locked transaction that persists the owned grant. State records the authenticated OAuth owner, organization, Store, incremented connection epoch and new-order cutoff. The cutoff is the later of Store import policy and connection time. Reconnection creates new state; old state and receipt observations remain history.

The additive `0027_automatic_receipt_intake.sql` initializes already-connected shops at migration/deployment time only when the last persisted OAuth actor still has owner membership. It never backfills from an old connection date. Existing grants without that evidence remain uninitialized and visibly require operator attention.

`ownedConnection()` verifies persisted owner membership, organization/Store ownership, Etsy source, shop linkage, connected encrypted grant, `transactions_r` and epoch before work and again after external I/O. The worker discovers tenants only from persisted state; it has no public command accepting a Store ID. Existing database uniqueness prevents duplicate shop ownership. Store locks precede state/inbox locks. Disconnected or stale epochs are excluded and cannot authorize new intake.

## 9. Durable discovery inbox

The Etsy module owns two additive tables:

- `etsy_automatic_intake`: connection-specific cutoff, modified-time checkpoint, frozen discovery window, offset, fenced lease, next attempt, bounded failures and last successful discovery.
- `etsy_automatic_receipts`: receipt ID and source-modified timestamp, tenant/epoch identity, PENDING/PROCESSING/SUCCEEDED/ATTENTION, attempts, fenced lease, safe error and bounded result code.

Composite ownership FKs and unique `(organization, Store, epoch, receipt, sourceModified)` prevent cross-tenant attachment and duplicate observations. No OAuth secret, raw response, customer answer or personal reading is stored in either table. Receipt identities are durably inserted in the same transaction as page checkpoint advancement. A failed write rolls back both; there is no external webhook acknowledgement to send.

## 10. Retry, crash recovery and idempotency

`runAutomaticIntakeTick()` claims one discovery page and at most one receipt per invocation. Leases last three minutes; an expired lease permits only replay-safe intake recovery. Five failed attempts lead to attention. Rate limits honor bounded Retry-After; backoff is bounded between existing exponential delay and one day. Authorization and connection failures stop the relevant operation conservatively. Errors persist safe codes, never response bodies or internal exception text.

Receipt command identity is the durable inbox UUID. Intake reuses receipt/unit uniqueness and existing audit-command idempotency. Worker claim identity is rechecked after obtaining the existing Store lock inside `syncOrderReceipt()`'s authoritative transaction. Lost or expired claims cannot authorize new receipt writes. If order commit succeeds but inbox settlement fails, lease recovery replays the same command and preserves the original units.

`retryAutomaticIntake()` requires internal capability plus owner authorization, Store/epoch verification, no live claim and an explicit UUID command. Audit replay returns the original decision; another resource under the same command is rejected. Retries preserve cutoff, cursor, purchased snapshots, pins and customer corrections. They do not approve historical adoption or repair holds.

## 11. Existing intake integration

The path is persisted OAuth state → bounded `readOwnedReceiptPage()` → durable receipt discovery → `readOwnedReceipt()` → `syncOrderReceipt()` → `assessReceiptForIntake()` → `ingestControlledReceipt()` → `ingestOrderInTransaction()`.

The listing/receipt normalizer, exact `etsy-selection/1` matching, historical adoption checks, conservative source/payment holds and receipt transaction remain authoritative. Quantity expands into independent units; mixed carts retain independent pins and holds. The optional internal guard added to `syncOrderReceipt()` runs after the established Store lock and does not substitute for authorization.

`suppressProductionAdmission: true` remains enforced. The intake worker imports no production runtime, provider, PDF renderer or delivery service. It does not create generations, AI requests or documents. Milestone 6.2A current-reading safety is unchanged.

**Important retained limitation:** existing controlled intake refuses a wholly ineligible new receipt. Such discoveries remain durable ATTENTION records, rather than becoming fictional Orders or successful imports. Mixed receipts with eligible lines retain held siblings in Orders. Historical or changed identity evidence remains held; explicit existing adoption/recovery is required. Private historical review records a review, not adoption authority.

## 12. Supported enumeration and reconciliation limits

Authority: [official `getShopReceipts` reference](https://developer.etsy.com/documentation/reference#operation/getShopReceipts) and [Etsy request standards](https://developers.etsy.com/documentation/essentials/requests/).

The receipt endpoint supports `transactions_r`, creation/last-modified bounds, limit 1–100, nonnegative offset, and created/updated/receipt-ID sorting. `readReceiptPage()` uses ten results, ascending receipt-ID order, creation cutoff and frozen modified-time bounds. It validates count/results, timestamps and any provided shop identity, retaining only receipt IDs and modification time. It does not apply paid/canceled filters that would hide later status changes. Requests use the existing server transport: HTTPS, scoped bearer token, application key, redirect rejection, 15-second timeout, 1 MiB response bound and precision-preserving JSON parsing. Either official API hostname is documented; this transport uses `api.etsy.com`.

The next window overlaps the checkpoint by five minutes and trails server time by 30 seconds. Pages resume from persisted offsets; incomplete pages never claim completed discovery. Offset growth stops at 10,000 and remains visible for operator recovery. Empty partial, malformed, foreign-shop and invalid evidence reject the whole page.

The API does not promise snapshot-isolated offset pagination. Overlap and repeated modified-time discovery improve recovery; they do not prove completeness under arbitrary late timestamps, changing pages or an arbitrarily large backlog. Orders before the connection/deployment cutoff are intentionally excluded. Reconciliation uses the same polling path; no undocumented scheduler or webhook completeness promise exists.

## 13. Diagnostics separation

Normal `src/app/(operations)/orders/page.tsx` renders a read-only intake status and no receipt-ID form. The existing queue, Order Detail, purchased-choice display, independent reading rows, Review links and PDF links remain intact. Reading approval/PDF availability are not represented as delivery.

`/etsy/diagnostics` contains the existing `OrderSync`, up to 20 safe current-epoch receipt observations, explicit retry controls and the private historical-review link. Both page and operational commands require the existing `INTERNAL_TOOLS_ENABLED=true` and `INTERNAL_OPERATOR_USER_IDS` allowlist, plus persisted owner permission. Production identity restrictions from `internal-access.ts` remain intact. Ordinary operators and ordinary non-allowlisted owners cannot invoke the hidden action directly. No new developer role exists.

## 14. Operational feedback and security boundaries

Orders distinguishes disconnected/reauthorization, missing order scope, environment disabled, uninitialized state, attention, discovered/pending retry, authorization failure, delayed discovery and recent successful checks. It claims recent polling progress only with persisted success within five minutes; an environment flag alone is insufficient. Older held observations do not override a newer successful observation for the same receipt. Detailed history stays in restricted diagnostics.

No GET/page load starts synchronization. No browser receives a secret or raw receipt. The worker is a trusted application process, not a public endpoint. Database ownership defenses supplement service authorization. Production PostgreSQL simultaneous transactions and deployment clock/rate-limit behavior still require acceptance.

## 15. Tests and acceptance evidence

Focused unit/action suite: **32 passed** across `automatic-intake.test.ts`, `order-sync-actions.test.ts`, `order-sync.test.ts`.

Focused disposable PGlite suite: **20 passed**, 52 unrelated tests skipped by the `automatic` name filter in `etsy-controlled.db.test.ts`. Covers atomic discovery rollback, pagination/overlap, concurrent replay, mixed quantity expansion, disconnect/scope/owner/epoch/shop isolation, historical cutoff, entirely held receipts, expired/lost claims, timeout recovery, restricted idempotent retries, retained correction/pins, truthful status and additive migration of existing owned grants without rewriting grants.

Executed validation:

| Check | Result |
| --- | --- |
| `pnpm test` | PASS: 1,052 tests, 99 files |
| `pnpm test:db` | PASS: 597 tests, 28 files; 461.60 seconds |
| Final focused automatic PGlite run | PASS: 20 tests; includes the final added revoked-actor recovery scenario and superseded-attention status assertions |
| `pnpm typecheck` | PASS, including final check after removing confirmed generated Next.js tooling noise |
| `NEXT_TELEMETRY_DISABLED=1 pnpm build` | PASS |
| `git diff --check` | PASS |

The full database invocation started before the last additional focused scenario was added; the final focused run executes that scenario and the revised automatic-intake behavior. Do not interpret 597 as the final tree's total test count. PGlite validates service/constraint behavior; it is not a claim of native PostgreSQL lock contention acceptance.

Browser attempt: the synthetic Vite fixture server was denied `listen` on `127.0.0.1:4180` with `EPERM`. No security workaround was used. Desktop 1440px, tablet 768px, mobile 390px, overflow, focus and interactive accessibility acceptance are **NOT VERIFIED**. Fixtures now separate normal intake notices from diagnostic receipt commands. Static source/render tests are not browser acceptance.

Live Etsy, application approval, webhook delivery and real customer intake acceptance: **NOT VERIFIED / NOT EXECUTED**.

## 16. Deployment prerequisites

The operator must have appropriate approved application access and existing encrypted OAuth configuration, apply the additive migration through the ordinary deployment process, set `ETSY_AUTOMATIC_INTAKE_ENABLED=true`, and supervise the dedicated `pnpm worker:etsy-intake` process. This command is separate from the fixture-only `pnpm worker` and never enables the AI production worker. A bounded invocation is available with `--once`; normal operation needs a supervised long-lived process. Serverless-only hosting must provide a suitable managed worker/trigger before claiming automatic operation.

The process was not started with live credentials here. No scheduler, portal configuration, migration or deployment was performed. Monitor persisted discovery delays, ATTENTION backlog and worker health. Existing shops begin at deployment cutoff; controlled diagnostics recover earlier missed receipts without broad historical adoption.

## 17. Remaining blockers and acceptance work

- Confirm actual Reading OS commercial/personal approved access for the intended third-party seller scale and real receipt access.
- Obtain official clarification of third-party webhook coverage, signature-entry syntax and retry timestamp semantics before adding the preferred transport. Webhook receiver/inbox/signature tests are intentionally absent.
- Deploy/supervise intake-only runtime and verify revocation, rate limits, clock behavior, pagination and downtime recovery against authorized synthetic purchases.
- Run native PostgreSQL concurrency acceptance and the blocked three-width browser checks.
- Wholly held/historical discoveries require operator attention; the existing Orders domain is not broadened to manufacture intake success.
- No production generation or delivery is enabled. Milestone 6.3 was not started.
