# Milestone 6.2B — Operational order intake

## Integration design (before implementation)

The live `EtsyIntakeAdapter.orders()` contract is deliberately unverified. The existing owned receipt sample is a maximum-three-receipt internal discovery pilot, without an operational pagination contract. This milestone therefore exposes one explicit receipt per owner command, using `readOwnedReceipt`, `assessReceiptForIntake`, and `ingestControlledReceipt`. It does not turn the sample pilot into bulk synchronization.

The server resolves membership and Store; the client supplies only a receipt identifier and command UUID. Connection/scopes/shop are checked before HTTP, and epoch/shop/ownership are checked under the existing Store lock after HTTP. HTTP is never inside a database transaction. Assessment and intake share a receipt-atomic transaction and existing lock order. All operational intake suppresses production admission.

Historical or unresolved candidates are reported without adoption. Existing explicit historical authorization remains authoritative. Entirely held receipts retain the controlled intake engine's no-eligible-lines restriction. Mixed eligible/held receipts retain independent held siblings. Exact purchased IDs, snapshots, pins and customer revisions remain unchanged on replay. Source drift is reported without guessing or rewriting historical evidence.

Queue projection reuses Review freshness and current output services. PDF availability is internal readiness, never delivery completion. Purchased-choice display reads retained purchased evidence and has no matching authority.

## Validation and limitations

Implementation and executed evidence will be recorded below. No live Etsy, AI, external storage or delivery acceptance is authorized in this milestone.

## IMPLEMENTED

### Existing architecture reused

- `src/modules/etsy/owned-receipt.ts`: `readOwnedReceipt` resolves an owner-authorized encrypted grant, refreshes it through existing connection management when necessary, reads an owned receipt and returns shop/epoch evidence. Grant material stays server-side.
- `src/modules/etsy/receipt-read.ts`: `readReceiptDetail` uses the existing shop receipt endpoint, a 15-second abort deadline, a 1 MiB response bound and receipt linkage validation. No new HTTP adapter or retry loop was added. Official reference: https://developers.etsy.com/documentation/reference/#operation/getShopReceipt (`transactions_r`). Repository bulk intake remains gated; the internal three-receipt sample is not operational pagination.
- `src/modules/etsy/controlled-intake.ts`: `assessReceiptForIntake` and `ingestControlledReceipt` retain the sole precision-safe normalizer and exact source-resolution path.
- `src/modules/products/runtime.ts`: retained history, exact `etsy-selection/1` IDs and durable line-specific historical authorizations determine configuration binding. Titles, labels, SKU and current inventory have no replacement authority.
- `src/modules/intake/service.ts`: `ingestOrderInTransaction` owns atomic Order → LineItem → FulfillmentUnit persistence, unique quantity indices, revision retention, conservative source/payment holds, pinned configuration and command audits.
- `src/modules/review/service.ts` and `src/modules/production/documents.ts`: the Milestone 6.2A current-reading checks remain unchanged and are reused for operational queue projection.
- `src/infrastructure/jobs.ts`: fixture-only job behavior is unchanged and is not used for operational receipt sync.

### Operational entry point and receipt discovery

`src/app/(operations)/orders/page.tsx` performs read-only access and queue projection. `OrderSync` displays an explicit receipt-ID form. Only the POST server action `syncOrdersAction` invokes `syncOrderReceipt`. Loading disables the command and announces progress; result feedback receives focus and links to persisted Order Detail when available. Disconnected, missing-scope and operator views have no sync form. Existing sample preview has no operational sync control.

The server action resolves `currentScope`; it forwards only receipt ID and command UUID. Store, organization, shop, approval versions and receipt ownership are not client authorities. `syncOrderCommand` rejects extra command fields. UUIDs identify idempotent commands and do not grant permission.

There is **no bulk discovery**, page-load synchronization, GET mutation, scheduled polling or new queue job. One owner command reads one receipt, with an additional operational cap of 100 quantity-expanded readings. Larger receipts are explicitly rejected before persistence rather than partially imported. Existing normalizer limits remain intact.

### Historical authorization and holds

Results distinguish imported, already imported, recorded with attention, historical approval required, ineligible and unresolved evidence. A receipt containing a historical-adoption requirement is not imported by broad authorization or by ordinary Sync Orders. Existing durable explicit adoption remains the only historical authorization. Unresolved mapping evidence is not advertised as an adoptable historical candidate.

Eligible mixed receipts can persist held siblings through existing controlled intake. Entirely held new receipts remain unimported under its established `NO_ELIGIBLE_LINES` policy; feedback names the conservative holds. No input, purchase choice or quantity recipient is guessed. Quantity allocation remains a per-unit hold.

Historical results link to `/etsy/historical-review` only for the existing internal allowlist. That page records review evidence; it does not itself authorize adoption or import. Other owners receive an explanation of the separate authorized process. This milestone does not expand that private workflow's access or implement a public adoption flow.

### Atomicity, replay and existing-only reconciliation

Owned HTTP reading occurs before a transaction. Inside the transaction, authorization is rechecked, the existing Store lock is acquired, and connected grant/scopes/shop/epoch are checked against fetched evidence. Assessment and controlled intake run on the same transaction connection, with nested savepoints and the existing Store-first lock order. Publication, customer correction, disconnection and competing intake serialize through their established Store locks. No external request occurs while the intake transaction is open.

New intake obtains the exact version map server-side and delegates to `ingestControlledReceipt`, which reassesses under the same lock. Any domain/database failure rolls back the receipt. Existing finance savepoint behavior is retained: financial projection failure is reported as attention rather than pretending the whole operation completed normally. Duplicate and concurrent replay reuse existing receipt/transaction/unit identities. Existing input revisions and ProductVersion references are preserved.

A narrow **existing-only reconciliation** path delegates to `ingestOrderInTransaction` with no version grants. It requires precisely the retained transaction IDs, listing IDs, exact choice keys and quantities, and requires every retained quantity index to exist. It cannot add lines, create units or bind an unconfigured historical reading. This permits cancellation/refund/payment changes and source-drift holds to be recorded without overwriting purchased snapshots or corrected inputs. Source drift remains held; it is not repaired. Finance is not recaptured by this reconciliation path. After either persisted intake path, feedback reads actual unit issues and counts; replay does not re-advertise an already resolved allocation hold from a receipt-level assessment.

Changed identity, quantity, missing transaction evidence or an incomplete receipt is reported unresolved without new persistence. This is not a successful full synchronization or a source repair workflow. Older source timestamps retain the intake engine's existing no-op behavior. Cancellation/refund holds are not automatically cleared.

Both intake paths explicitly set `suppressProductionAdmission:true`. ASSISTED configuration does not override this suppression. No Generation, AIRequest, production admission, PDF work or delivery is initiated by Sync Orders. Existing correction/production policies outside this command are unchanged.

Unexpected failures use non-sensitive feedback and instruct the seller to check Orders before replaying. This avoids claiming a receipt was absent after an ambiguous database acknowledgement or post-commit refresh failure. Transport failures known to precede persistence identify authorization, rate limit, timeout or invalid owned evidence. No implicit retries were added.

### Queue projection and purchased choices

`ordersWorkQueue` decorates the existing paginated/searchable list without persisting an order-level substitute for unit state. Preparation readiness uses `buildGenerationContext` in read-only repeatable-read transactions. Review readiness uses `orderReadingReviewStatuses`, including current generation, input revision, pins and holds. Every independent reading must qualify before aggregate approval/PDF readiness is displayed. Approved output uses `readingOutputStatus`; outdated approvals or historical AVAILABLE PDFs cannot confer current readiness.

Generated, Awaiting Review, Approved, PDF Pending, PDF Ready and PDF attention have distinct labels. PDF Ready/Approved explicitly display **Delivery not yet implemented**. No Delivered or fulfillment-complete state was introduced. Existing list filters still group the underlying persisted intake/generation lifecycle; they are not new approval/PDF-specific filters. They do not replace authoritative mutation checks. Projection can reflect different read snapshots if state changes during page construction; operational mutations retain their own transaction revalidation.

`purchasedChoices` projects `snapshot.etsySource.purchaseSelections`, retaining readable purchased labels alongside property/value IDs. Missing display labels fall back to retained IDs, not current inventory. Legacy snapshots use their existing `variations`. The projection is read-only and does not alter mapping identity, source fingerprints or persisted evidence. Order Detail otherwise retains its reading rows, correction revisions, Review navigation and historical PDF access.

### Security

Persisted membership and owner role are checked before HTTP and again at intake. Scope organization, Store source, shop ownership, connected grant, `transactions_r`, exact receipt linkage and connection epoch are enforced server-side. Revocation during HTTP prevents persistence. Operator and cross-store tests reject access. Response feedback does not serialize customer answers, bodies, OAuth tokens or raw database exceptions. No schema, migration, permission, Product Setup or current-reading eligibility changes were made.

## TESTED

Executed results are recorded after final validation below. Tests use synthetic receipts and disposable PGlite databases with repository migrations; they do not connect to the development or production database.

- `tests/etsy-controlled.db.test.ts`: existing controlled-intake regressions plus owner initiation, denied operator/missing scopes/disconnection, owned shop/epoch fencing, revocation during read, concurrent replay, corrections, immutable version pins, mixed 2+1 quantity expansion, held receipts/siblings, historical non-adoption, cancellation reconciliation, changed quantity refusal, transaction failure and the 100-reading bound. Sync-specific creation tests assert no generation, production admission, AI requests, document snapshots or artifacts.
- `tests/order-sync.test.ts`: strict command shape, safe rate-limit/auth/API/timeout errors, accessible form structure, operator/disconnected/scope presentation, retained purchased-choice labels/IDs, legacy fallback and no fictitious delivery state.
- `tests/order-sync-actions.test.ts`: server-derived scope, ignored client Store/version fields, persisted order links/revalidation, historical and partial feedback, errors and auth redirect behavior.
- `tests/orders-work-queue.test.ts`: authoritative service composition for current Review/approval/PDF states, historical exclusion, sibling independence, preparation admission and hold precedence. These are isolated mocked-service unit tests, not real-store acceptance.
- Existing Review, PDF, artifact retrieval, tenant isolation and Milestone 6.2A freshness regressions are included in full validation.

## NOT VERIFIED / remaining acceptance

No real Etsy synchronization, OAuth refresh against Etsy, real-store latency, provider dispatch, customer PDF rendering, external storage or delivery was exercised. Runtime requires the existing live OAuth configuration and encrypted grant; missing environment configuration produces safe feedback. Enumeration/pagination and bulk sync remain gated. Fully held new receipts and receipts above the operational bound require a separately supported intake operation. Source identity/quantity changes require a future authorized reconciliation workflow; the command does not guess a repair. Historical adoption remains separate from the internal candidate review UI.

### Browser acceptance blocker and reproducible fixture

Browser acceptance at **1440, 768 and 390 px is NOT VERIFIED**. The local fixture server was attempted, but listening on `127.0.0.1:4180` failed with environment `EPERM`. A compiled static fixture was then attempted; the browser security policy rejected the `file:` URL and explicitly prohibited workarounds. No alternate protocol, browser surface or policy bypass was attempted. Therefore no overflow, focus, mobile touch or browser accessibility acceptance is claimed.

The checked-in isolated fixture uses actual ApplicationFrame, OrdersListPage, OrderSync and OrderDetailView components, with synthetic local actions and no application server/database/API imports at runtime:

```sh
node scripts/acceptance/orders-intake/preview.mjs
```

On an environment permitted to host loopback, open `http://127.0.0.1:4180/?fixture=connected`. For each requested width, inspect `connected`, `disconnected`, `scope`, `operator`, `progress`, `partial`, `historical`, `delayed` and `detail` fixture modes. Connected/partial/historical/delayed require entering synthetic receipt `900` and submitting the fixture form. Progress deliberately stays pending. The queue includes Needs Attention and PDF Ready; Detail includes Love ×2 / Career ×1, retained choice IDs and independent historical Review/PDF links. Measure document/body overflow, confirm accessible labeling, pending disabling/status, post-result focus and mobile layout. Fixture actions exercise presentation only, not authenticated Next server actions or live transport.

## Executed validation — 2026-10-11

Repository: `etsy-reading-os`, branch `codex/ui-ux-design-lock`; starting HEAD and required ancestor `6f5eaed70d34ab64828acc212b5bb48ca3a59553`. Starting working tree was clean. Node 22.23.1 / pnpm 9.7.1 were used.

| Check | Executed result |
|---|---|
| `pnpm test` | PASS: 1,038 tests, 98 files; final run 30.21 seconds |
| `pnpm test:db` | PASS: 578 tests, 28 files; final run 434.47 seconds; disposable PGlite only |
| Focused controlled/operational intake DB suite | PASS: 52 tests, including replay after quantity allocation |
| `pnpm typecheck` | PASS, including typed isolated browser fixture |
| `NEXT_TELEMETRY_DISABLED=1 pnpm build` | PASS, production webpack build |
| `git diff --check` | PASS |
| Authenticated real-store / live Etsy acceptance | NOT VERIFIED; not executed |
| Browser acceptance at 1440/768/390 | NOT VERIFIED; environment and browser policy blockers described above |

The build's generated `next-env.d.ts`/`tsconfig.json` additions were removed from the change; the original project compiler configuration is preserved. No dependency, lockfile, database schema or migration changes were introduced. No push or deployment is part of this milestone.
