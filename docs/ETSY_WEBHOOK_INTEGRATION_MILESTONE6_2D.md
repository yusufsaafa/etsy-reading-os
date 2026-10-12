# Milestone 6.2D — webhook-first Etsy order intake

## Status and checkpoint continuity

**IMPLEMENTED:** Standard Webhooks v1 signature parser, public receiver, durable
notification inbox, bounded intake worker, connection fencing, restricted
webhook diagnostics and truthful Orders status. Existing polling is unchanged
and remains the backup/reconciliation transport. Both transports use the same
controlled receipt intake; no AI, document or delivery capability was activated.

The earlier checkpoint stopped because Etsy's guide did not specify header
version/delimiter grammar. The continuation explicitly authorizes Standard
Webhooks v1 as an interoperability assumption. The original digest primitive
and its 25 synthetic known-answer/regression cases are preserved and extended.
The former blocker is resolved for local implementation, not for live acceptance.

**NOT VERIFIED:** Etsy-specific signature wire compatibility, Portal delivery,
third-party OAuth-shop coverage, deployment/supervision and live intake.
**BLOCKED:** Browser acceptance: the fixture server cannot bind to localhost
(`EPERM`); exact evidence is recorded in the validation section below.
No live integration claim follows from fixture success. Milestone 6.3 is excluded.

## Repository verification

Repository: `yusufsaafa/etsy-reading-os`.
Branch: `codex/ui-ux-design-lock`.
Starting HEAD/base: `9396de2a526960f91e4c6f3063af578df1d2f271`.
Ancestry passed. The only starting changes were the three authorized checkpoint
files: `webhook-digest.ts`, its tests and this document; they were inspected and
preserved. No branch switch, reset, clean or user-change discard was performed.

## 1. Source authority and exact assumptions

Reviewed on 2026-10-11:

- [Etsy webhook guide](https://developers.etsy.com/documentation/essentials/webhooks/)
- [Standard Webhooks specification](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md)
- [Standard Webhooks Python reference](https://github.com/standard-webhooks/standard-webhooks/blob/main/libraries/python/standardwebhooks/webhooks.py)
- [Etsy personal-application access announcement](https://github.com/etsy/open-api/discussions/1537)
- [Etsy event-name announcement](https://github.com/etsy/open-api/discussions/1535)
- [Etsy staff flat-payload clarification](https://github.com/etsy/open-api/discussions/1564)

Etsy confirms `webhook-id`, `webhook-timestamp`, `webhook-signature`, secret
prefix/decoding, HMAC-SHA256 over ID + dot + timestamp + dot + exact raw body,
Base64 output, matching any entry and a 300-second timestamp example.
Standard Webhooks defines `v1,BASE64` entries separated by spaces.
**INTEROPERABILITY ASSUMPTION:** Etsy has not explicitly confirmed that grammar.
The strict parser implements it because the continuation authorizes the assumption;
a signed Etsy Portal test must establish actual compatibility.

## 2. Events and bounded payload

Etsy lists `order.paid`, `order.canceled`, `order.shipped`, `order.delivered` and
flat fields `event_type`, `resource_url`, `shop_id`. The receiver validates those
fields, preserves numeric identifier precision through the existing `parseEtsyJson`,
and accepts only a literal HTTPS Etsy receipt URL with matching shop identity.
Ports, userinfo, other hosts, queries, fragments, escapes and mismatches are rejected.
Identifiers are bounded opaque decimal strings. The payload URL is never fetched.

Only `order.paid` creates an intake obligation. Other listed events are durably
recorded as `SUCCEEDED / IGNORED_EVENT`; unknown event types return 400. Cancellation
reconciliation remains the existing backup/manual path. Shipment/delivery events
never imply Reading OS PDF delivery or fulfillment completion.

## 3. Signature verification

`src/modules/etsy/webhook-digest.ts` retains `verifyEtsyWebhookDigest()` and adds
`verifyEtsyWebhookSignature()` / `webhookSecretConfigured()`.

The parser requires explicit v1 entries, strict canonical Base64 (padding may be
omitted), and a 32-byte digest. Unknown versions and malformed entries reject the
entire header, even alongside a valid entry. At most eight entries and 4096 header
characters are accepted. Identity is bounded and excludes dots/whitespace. Every
accepted entry is compared using `timingSafeEqual`; no unversioned/unsigned fallback
exists. The inclusive freshness margin remains 300 seconds in either direction.
Raw bytes are authenticated before any JSON parsing. Secrets stay server-side.

Compatibility follow-up (2026-10-11): the shared `decodeSigningSecret()` accepts
canonical nonempty Base64 key material either bare or with `whsec_`; optional
Base64 padding remains supported. Both `webhookSecretConfigured()` (used by the
HTTP receiver and `webhookIntakeStatus()`) and digest verification use this decoder.
The 1024-character secret bound remains. No prefix is added, no UTF-8/hex fallback
is attempted, and malformed/noncanonical Base64 is rejected. Signature grammar,
HMAC-SHA256, constant-time comparison and timestamp checks are unchanged.

The reported Portal secret lacks the prefix; official Etsy documentation still
shows `whsec_` stripping followed by Base64 decoding. Local test-environment
inspection found a noncanonical value, so this code change alone cannot establish
live compatibility or resolve that configuration. Environment files were unchanged.
Synthetic prefixless/prefixed known-answer, invalid-key, route and shared-status
regressions were added. Live Portal acceptance remains unverified.
The original known-answer vector was computed independently using Python; it is
synthetic, not supplied by Etsy. Multiple entries support producer-side key rotation
while the consumer accepts a matching configured secret.

## 4. Public HTTP receiver

**IMPLEMENTED:** `POST /api/webhooks/etsy` in
`src/app/api/webhooks/etsy/route.ts`, Node.js runtime. Other methods receive the
framework's 405 response; `handleEtsyWebhook()` also rejects non-POST requests.
`src/modules/etsy/webhook-receiver.ts` bounds streamed raw bodies to 64 KiB,
validates signature/timestamp, decodes strict UTF-8 and validates payload evidence.
These bounds are application safeguards, not claimed Etsy limits.

The authenticated factory produces frozen, runtime-tagged `VerifiedWebhook`
evidence. `acceptVerifiedWebhook()` rejects objects not produced by that factory.
Only then is the database opened. No seller session is needed; no manual intake
endpoint is exposed. Missing signing configuration returns 503; invalid signature
401; invalid payload 400; oversize 413; failed durable write 503. Error bodies are
empty. No raw payload, token, customer answer or internal exception is logged.

A conventional 204 follows successful durable commit, including identical replay.
Receipt retrieval is not performed in the request. Exact Etsy acknowledgement
expectations and whether timestamps refresh on retry remain **NOT VERIFIED**;
timestamp checks were not weakened. Etsy documents delayed retries and Portal
manual retry/recovery; neither exactly-once delivery nor completeness is assumed.

## 5. Durable webhook inbox and migration

`webhookEvents` / `etsy_webhook_events` in `src/db/schema.ts` stores a globally
unique event ID, type, shop/receipt IDs, raw-body SHA256, first signed/received time,
optional Store/epoch fence, status, attempts, claim/lease, next retry, safe result/error
and settlement time. No raw payload or resource URL is stored.

This inbox is deliberately separate from `automaticReceipts`, whose identity is
Store + epoch + receipt + source-modified time. Notification identity and receipt
identity cannot be conflated. `drizzle/0028_etsy_webhook_inbox.sql` is additive,
with generated snapshot/journal entries, composite ownership FK, bounds/status/lease
constraints and an immutable-evidence trigger. Initial tenant/epoch binding cannot
be rewritten, including a quarantined unbound event. An identical ID with different
body/shop/receipt/type is rejected; retries may have a different signed timestamp.

Statuses follow the existing receipt convention: `PENDING`, `PROCESSING`,
`SUCCEEDED`, `ATTENTION`. Unbound unknown/ambiguous/disconnected notifications are
quarantined without order authority. Constraints disallow partial tenant bindings.
The migration has only been exercised in disposable PGlite; no persistent migration
was executed. Retention cleanup is not implemented; operator retention/deletion
policy must cover these minimal notification records before production rollout.

## 6. Worker and recovery

`runWebhookIntakeTick()` in `src/modules/etsy/webhook-intake.ts` claims at most one
event per tick, uses a three-minute lease and a fresh UUID token, and bounds attempts
to five. A supervised operator-owned process may invoke
`pnpm worker:etsy-webhooks` (`scripts/etsy-webhook-worker.ts`), optionally `--once`.
The script is gated and was not started during implementation.

Expired leases are reclaimable. Store-first locking precedes event locks. The worker
rechecks authorization before HTTP and, after HTTP, rechecks the connection and
lease inside `syncOrderReceipt()`'s authoritative transaction. Timeout/transient
failure gets bounded exponential backoff; 429 respects Retry-After without shortening
it. Authorization/permanent failure or retry exhaustion becomes attention. Failure
codes contain no transport bodies or personal data. A lost claim cannot settle over
a newer claim. A crash after intake commit reuses the same event UUID command and
receipt identity rather than creating new work.

## 7. Tenant routing and connection fencing

Durable acceptance looks up the exact verified shop ID, locks the matching Store
and captures its current grant epoch. Unknown/ambiguous ownership is quarantined.
A connected encrypted grant, `transactions_r`, existing OAuth cutoff/actor state and
persisted owner membership are required. Capturing the epoch at first acceptance
prevents a delayed worker or replay from acquiring a later reconnect's authority.

The worker independently resolves current Store/organization/shop and persisted
OAuth actor through `automaticIntake`, calls `verifyScope(..., true)`, and verifies
connection/scopes/epoch. The signed notification itself is not authorization.
`readOwnedReceipt()` then obtains the current encrypted OAuth grant via the existing
owned client. External I/O is outside transactions. Receipt ID/shop linkage and
creation cutoff are checked, with connection and claim revalidation after I/O.
Cross-tenant queries and retries reject scope mismatches. Revoked actor membership,
revoked grants, disconnect and changed epochs cannot create new Orders.

## 8. Shared controlled intake

Both transports converge on `syncOrderReceipt()` in `src/modules/orders/sync.ts`.
Its existing `assessReceiptForIntake()` and `ingestControlledReceipt()` in
`src/modules/etsy/controlled-intake.ts` own normalization and matching; ultimately
`ingestOrderInTransaction()` performs receipt-atomic persistence. No competing
normalizer, matching service, order model or new generation admission was added.

Exact `etsy-selection/1` identity, full purchased evidence, ProductVersion pins,
customer revision corrections, mixed-cart independence, quantity expansion,
source/payment/quantity holds and existing-only reconciliation restrictions remain.
Wholly ineligible new receipts remain attention without fabricated Orders; an eligible
line with a mapped input-held sibling preserves all lines/units and attention. An
ambiguous unmapped sibling can conservatively hold the whole receipt under existing
policy; webhook intake does not override that boundary. The existing 100-reading
command bound remains. Both automatic paths suppress production admission.

## 9. Historical safety and OAuth relationship

Existing OAuth completion creates the Store/epoch actor and cutoff checkpoint even
when backup polling is disabled. Webhook processing reuses that cutoff and rejects
an authoritative receipt created before it; a freshly signed notification does not
approve historical adoption. Existing historical-review approval remains separate.
Replays preserve original snapshots, corrections and configuration pins. There is no
per-seller webhook registration, API key, callback or signing-secret form.

## 10. Polling backup and transport coexistence

`runAutomaticIntakeTick()`, `automaticReceipts`, discovery checkpoints and
`scripts/etsy-intake-worker.ts` are unchanged. Their architectural role is backup
reconciliation. Frequency and production scheduling were not changed or activated;
no additional polling engine or scheduler exists. The webhook worker does not invoke
polling. Orders and diagnostics explicitly label existing polling as backup.

Different webhook IDs can refer to one receipt; polling can discover that receipt
before, after or concurrently with webhook processing. Store locks and existing
receipt/line/unit uniqueness provide one Order and one expanded unit set. The webhook
inbox retains its own notification history. No duplicate generation work is admitted.

## 11. Restricted diagnostics and truthful status

`/etsy/diagnostics` retains `internalOperatorAllowed()` and persisted owner checks.
`webhookDiagnostics()` exposes only recent safe identity/type/time/status/result,
attempt/claim state; no payloads, answers, body hashes, grant tokens or secrets.
`retryWebhookEvent()` requires the same gates, Store-first locking, current epoch,
attention status, no active claim and an idempotent audited command. It cannot rebind
an old event to a new connection, or retry rate-limited work before its deadline.
Unknown/unbound events are not shown to arbitrary tenant owners; global quarantine
triage is a trusted application-operator database responsibility, not a new public role.

`webhookIntakeStatus()` reports disconnected/missing scope/not configured/configured,
received/pending, processing, attention, already imported or succeeded using persisted
evidence. Configuration never implies an active or verified Etsy transport. The UI
always preserves Portal interoperability/coverage uncertainty. Normal Orders has no
receipt-ID field or seller webhook controls, and existing Review/PDF navigation is
unchanged. Diagnostics wraps long event IDs; retry controls use existing button styles.

## 12. Application registration and deployment

Etsy's guide describes application Developer Portal / Webhook Portal configuration,
callback/event selection and signing-secret retrieval. It states personal/commercial
application webhook availability. No per-shop registration API was invented. The
Reading OS operator owns this setup; seller setup remains Connect Etsy only.

Required operator deployment work (not executed):

- Deploy the additive migration using normal controlled deployment procedures.
- Expose the public HTTPS POST callback and configure the application subscription
  for `order.paid` in Etsy Portal.
- Configure server-only `ETSY_WEBHOOK_SIGNING_SECRET` (whsec_ Base64 key) and
  existing OAuth/encryption/database credentials.
- Supervise the durable webhook worker with `ETSY_WEBHOOK_WORKER_ENABLED=true`,
  `ETSY_ADAPTER=etsy`, `ETSY_LIVE_OAUTH_ENABLED=true` and database access.
- Operate existing polling only as backup reconciliation under its existing gate;
  no frequency/runtime changes were authorized here.
- Confirm clock synchronization, lease recovery, safe monitoring and notification
  retention policy in the actual host/runtime.

No real subscriptions, Portal changes, persistent migrations, external API requests,
AI dispatch, PDFs, object-storage writes, delivery, push or deployment occurred.

## 13. Test evidence and validation

**TESTED:** `pnpm test` passed 1,108 tests in 102 files.
The focused signature/receiver/route/UI unit run passed 85 tests in five files.
Tests use synthetic Standard Webhooks v1 signatures, not Etsy wire captures.
The isolated database suite exercises real PostgreSQL semantics through disposable
PGlite, with injected receipt/page readers; it never contacts Etsy. **TESTED:** All 55 focused webhook database tests passed, including the three
webhook/polling coexistence cases and isolated Drizzle journal application.
`pnpm typecheck` and `NEXT_TELEMETRY_DISABLED=1 pnpm build` passed. Node 22.23.1
was used. Only inspected Next-generated tooling changes were removed afterward.
**TESTED:** `pnpm test:db` passed 653 tests in 29 files (488.49 seconds),
including the existing current-reading, Review and document artifact regressions.
`git diff --check` and `git diff --cached --check` passed; `drizzle-kit check` also
passed. The build includes the dynamic `/api/webhooks/etsy` route. No persistent
database or external service was used for these tests.

**NOT VERIFIED / BLOCKED:** Attempting the existing isolated browser fixture server
failed with `listen EPERM 127.0.0.1:4180`. Therefore 1440, 768 and 390 px acceptance
could not execute. No alternate protocol/runtime or security bypass was attempted.
Static UI regressions are synthetic evidence, not browser or live Etsy acceptance.

Coverage includes authenticated acceptance/failure, duplicate/concurrent identity,
unknown/ambiguous shop quarantine, owner/scope/revocation/epoch races, receipt linkage,
mixed carts/quantity, holds, historical cutoff, missing active ProductVersion,
corrections/pins/source drift, expired/lost leases, crash after intake, retry/backoff,
authorization failures, five-attempt bound, webhook/polling ordering/concurrency,
restricted idempotent retries, truthful status and additive migration/immutable
constraints. Assertions ensure no Generation, AIRequest, usage settlement, document
snapshot/production/artifact or new production queue entry from webhook intake.
Customer-correction tests compare preexisting queue rows because the established
correction command may independently admit work; webhook replay adds none.

## 14. Live acceptance requirements and remaining limits

**NOT VERIFIED:** A signed Etsy Portal delivery must validate actual v1 grammar,
multiple-signature rotation, exact raw-body transport, timestamp freshness/retry
behavior, 204 acknowledgement/retry interoperability and end-to-end receipt intake.
Third-party OAuth shops must be tested under this specific application's approval
and subscription configuration; own-shop or synthetic success is insufficient.
OAuth expiry/refresh/revocation and missed-event recovery must also be exercised in
an authorized real environment. Native PostgreSQL multi-process concurrency and
production worker supervision remain acceptance work beyond PGlite fixtures.

Canceled/shipped/delivered notifications are intentionally ignored by this new path.
Existing reconciliation supplies supported source/status updates; PDF/customer
delivery remains unimplemented here. Missing configuration/source evidence stays
attention; the system does not fabricate inputs or silently adopt historical orders.
No automatic completeness guarantee, live webhook-active claim, or Milestone 6.3 work
is included. Implementation validation and live interoperability are separate.

## 15. Changed files and completion boundary

| Area | Files |
| --- | --- |
| Webhook contract and receiver | `src/modules/etsy/webhook-digest.ts`, `src/modules/etsy/webhook-receiver.ts`, `src/app/api/webhooks/etsy/route.ts` |
| Durable worker/orchestration | `src/modules/etsy/webhook-intake.ts`, `scripts/etsy-webhook-worker.ts`, `package.json` |
| Persistence | `src/db/schema.ts`, `drizzle/0028_etsy_webhook_inbox.sql`, `drizzle/meta/0028_snapshot.json`, `drizzle/meta/_journal.json` |
| Orders/diagnostics | `src/app/(operations)/orders/page.tsx`, `src/app/etsy/diagnostics/page.tsx`, `src/app/etsy/diagnostics/actions.ts` |
| Focused tests | `tests/etsy-webhook-digest.test.ts`, `tests/etsy-webhook.test.ts`, `tests/etsy-webhook-route.test.ts`, `tests/etsy-webhook.db.test.ts` |
| Existing regression fixtures | `tests/etsy-controlled.db.test.ts`, `tests/orders-list.test.ts`, `tests/orders-sample-preview.test.ts` |
| Documentation | `docs/ETSY_WEBHOOK_INTEGRATION_MILESTONE6_2D.md` |

The existing automatic polling implementation, owned receipt transport, controlled
intake, exact-choice resolution, generation, Review and document services have no
source changes. The old 0027 migration test now explicitly loads only migrations
preceding 0027, so the new 0028 FK is not applied out of sequence in that isolated
legacy fixture. Orders page tests mock the new read-only status query separately.

Local implementation and isolated validation are complete. Actual Etsy operation
remains **NOT VERIFIED** until authorized Portal/app coverage acceptance and operator
deployment are completed. No push, deployment or Milestone 6.3 work is included.


### Secret compatibility follow-up validation

- Digest, signature/receiver and HTTP route suites: 78 tests passed.
- Shared secret validation / intake status suite: 6 tests passed.
- Isolated in-memory PGlite webhook suite: 55 tests passed, including duplicate,
  concurrent-delivery and changed-evidence replay rejection. No external DB used.
- Full TypeScript check (`tsc --noEmit --incremental false`): passed.
- `git diff --check`: passed.
- Additional core TypeScript check: failed with four `string | undefined` errors
  in unchanged `src/app/actions.ts`, `src/app/onboarding/actions.ts` and
  `src/modules/identity/session.ts`. The core include list omits the existing
  `src/types/next-auth.d.ts` Session augmentation; full typecheck includes it.
  No unrelated configuration or identity fixes were made. No commit was created
  because not every check passed.


### Authenticated Portal test compatibility

`handleEtsyWebhook()` verifies the bounded raw body using the existing strict v1,
HMAC-SHA256, canonical Base64, timestamp and timing-safe comparison rules before
checking `webhook-test`. Only the exact header value `true` acknowledges a Portal
transport test with an empty 204. No VerifiedWebhook evidence is constructed and
no acceptance callback, database construction, receipt fetch or worker dispatch
occurs. The test marker itself is not part of the signed content: it selects only
a non-persistent acknowledgement, never intake authorization.

Non-test events retain the existing authenticated payload factory, strict literal
`api.etsy.com` allowlist, matching shop IDs, durable inbox, tenant and epoch fencing.
The synthetic `openapi.etsy.com` example does not justify expanding that allowlist.
Real-event host compatibility and live Portal interoperability remain unverified;
a real signed event using another host would still be rejected pending separate
source verification and narrowly scoped compatibility work.
