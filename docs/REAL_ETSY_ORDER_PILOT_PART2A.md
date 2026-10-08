# Real Etsy order pilot — Part 2A

Date: 2026-10-08. Starting HEAD: `88c4b609af6b6f49064b66acb23fc75cd0482df1`, local Mac checkout, branch `codex/ui-ux-design-lock`. Exact preflight passed; only inspected Next.js-generated `next-env.d.ts` / `tsconfig.json` changes existed and remain excluded.

## Existing architecture reused

The bounded Part 1 GET reader now lives in `modules/etsy/receipt-read.ts`; the acceptance script re-exports it rather than creating another client. `readOwnedReceipt` authorizes the owner, reads the encrypted grant, uses the existing refresh mechanism if necessary, fetches one explicitly selected receipt from the owned shop, checks detail linkage and available seller identity, and retains shop/connection epoch for settlement. No polling, webhook enablement, route or startup execution was added.

`normalizeEtsyReceipt` → `etsy-purchased-line/v1` → existing `resolveEtsySourceConfiguration` / `etsy-product-policy/v1` → existing receipt-atomic `ingestOrder` engine remains the pipeline. `ingestOrderInTransaction` exposes that same engine for the controlled application command so assessment and settlement share the Store-first transaction lock. Product/Reading systems were not replaced.

## Historical approval and exact resolution

`authorizeHistoricalAdoption` accepts a bounded `etsy-historical-adoption/v2` command: owner command UUID, explicitly selected owned published ProductVersion and one canonical purchased-line envelope. It derives the Store/shop, receipt, transaction, listing, complete canonical selection identity, exact purchase timestamp and server-computed SHA-256 source fingerprint. Unsupported or incompatible source cannot acquire this approval. Both ACTIVE and retained ARCHIVED versions can be explicitly selected; DRAFT or foreign versions cannot.

The existing append-only adoption table gains three nullable evidence columns (transaction, shop, fingerprint). New line uniqueness prevents a second pin for the same owned receipt/transaction. Command replay is idempotent; changed commands/conflicting pins reject. Legacy v1 rows remain untouched and retain legacy behavior, but **cannot authorize the new controlled ingestion path**. No broad historical-import switch was introduced.

The fingerprint binds the complete bounded purchased evidence except transport observation time. Answer, status, quantity, source identity or other evidence changes hold/reject rather than silently repair approval. This is intentionally conservative: changed display/order evidence can also require review, although labels/order never define Product semantics. New evidence cannot authorize a sibling transaction even when its configuration is identical.

Normal purchases require an exact active approved property/value combination and the existing activation-time fence. No labels, SKU, position or current listing inventory determine behavior. Missing/unapproved combinations hold. Retained units replay against their original pinned version; new activation does not rebind them. Operational pause is checked even against retained configurations.

## Purchaser and customer context

The verified receipt `buyer_user_id` is preserved as optional presence-tagged purchaser account evidence in the canonical v1 receipt. If both receipt and transaction purchaser references are present they must agree. Safe int64 lexical parsing is reused. Names, email and address fields remain non-consumed.

Order purchased/latest snapshots carry a minimal typed `purchaser` object (`source=etsy`, `role=PURCHASER`, account reference or null). No separate customer architecture/column was needed. Reading units are linked to this provenance through their existing line/order relationship. Reading subject and fulfillment recipient are **unassigned**, never inferred from the purchaser or answer/name order. Purchaser identity is not added to AI prompts in this milestone; downstream use remains a separately reviewed decision.

Seller-approved exact question/property mapping copies the entire original answer into the configured customer field and revision-zero customer context. Whitespace, names, dates and question text are unchanged. No splitting, translation, date extraction or person-role inference occurs. Unsupported dropdown/upload/unknown evidence remains held; files are never downloaded or treated as text.

## Controlled ingestion and dry-run

Private server application boundaries:

- `dryRunOwnedReceipt`: owned GET, then genuinely read-only repeatable-read DB assessment; returns counts/reason categories only. No rollback-based pseudo-dry-run.
- `approveOwnedHistoricalLine`: separate explicit owned GET and approval of one selected transaction/version via the existing adoption command. It never ingests.
- `ingestOwnedReceipt`: separate explicit owned GET and controlled command containing a receipt selection, command UUID and exact approved transaction→ProductVersion choices.

These have no public route, browser/startup hook or worker entry. The raw-body integration boundary exists for trusted server evidence and isolated tests, not browser-submitted arbitrary receipts. The owned wrapper supplies fetched shop identity and connection epoch; ownership is rechecked in the locked transaction. Dry-run/discovery never calls either mutation boundary.

Controlled ingestion reuses existing atomic persistence and suppresses production admission. Even ASSISTED configurations create no queue/provider work. No Generation, document or delivery is created. Existing ordinary ingestion admission remains unchanged.

Existing per-unit partial handling is preserved: a receipt with an eligible and an unsupported/unmapped line retains both lines; only the applicable line gets an approved binding, and unsupported work stays held. A wholly ineligible receipt is rejected without domain writes. If source identity cannot be represented by the existing strict Order/line contract, controlled ingestion rejects the entire receipt rather than omit it. Quantity N produces N stable unit indexes, but quantity >1 retains `quantity_context` until explicit allocation; this milestone does not guess recipients.

Store locking, tenant uniqueness and one receipt transaction protect replay/concurrency. A partial DB failure rolls back the receipt, units, context and audit together. Observation-time changes alone do not produce false source drift. A controlled command audit is idempotent under the Store lock; reuse against another receipt rejects transactionally. Changed purchased evidence rejects controlled replay and leaves retained context untouched. Previously held units are not silently rebound after later setup; their explicit reconciliation remains outside this command.

## Generation-policy forwarding and discovered edge case

Generation re-triage omitted the pinned `etsyFulfillment` policy, causing supported source lines to hold as unmapped. The existing context builder now forwards that policy into the existing triage call. Tests build context without dispatch and verify pinned production mode, preparation target/priority, output, sections, input mappings and untouched answers. No prompt/provider architecture changed.

A stronger native replay test found that an archived-version insert attempt fired the ACTIVE-only unit trigger before `ON CONFLICT`. Controlled replay now reuses existing units. For first-time historical ingestion, migration 0023 narrowly allows an ARCHIVED pin only where a v2 approval matches owned order/transaction/listing/selection/shop/time/version lineage. Application resolution additionally verifies the approved fingerprint. Ordinary new purchases still require ACTIVE authority; immutable unit/version guards remain intact.

## Migration and validation

Migration: `0023_dusty_ultron.sql`, generated through Drizzle with explicit trigger additions. Isolated migration validation replays pre-0023 history, preserves a legacy approval and existing fixture data, applies the new migration, and verifies repeat no-op/history. Fresh schemas are exercised by every DB test. Native local migration history advanced **23 → 24**; repeat migration was a no-op and a sanitized hash comparison confirmed all existing public data preserved (new nullable adoption columns excluded from equivalence). No MRH approval or Product was changed.

Validation passed: 101 focused unit tests in seven files; the six-file intake/source/history/generation/production DB regression run passed 150 tests, followed by a final 25-test controlled DB rerun after additional coverage/review. Native acceptance passed 29 tests in two files (the 25 controlled tests plus four native tests), including three repeated deterministic approval/ingestion races. These overlap and must not be summed as distinct test totals. Typecheck, production build and diff check passed; Drizzle generation reported no schema drift. Native tests use isolated disposable databases and the established native adapter, not MRH data. Three repeated barrier-controlled races observe two actual PostgreSQL lock waiters before releasing the holder; they converge to one approval and one Order/line/unit/context. Server: PostgreSQL 16.14 (Homebrew), aarch64 Apple Darwin; runtime Node 22/postgres-js 3.4.7 through Drizzle. Three reserved backend IDs prove independent connections at READ COMMITTED. Statement/lock/test timeouts bound execution. This is exercised-path evidence, not a mathematical deadlock proof.

Initial failures were surfaced and corrected: an invalid test expected a supported int64 JSON integer to reject; a native fixture omitted a required synthetic user name; the archived-version trigger interaction above required the minimal production fix. Final passing reruns, rather than those initial failures, determine validation.

## Real MRH read-only acceptance

Existing encrypted grant refreshed successfully without reconnect or a tunnel. One list and three detail GETs returned HTTP 200/JSON within the bounded 90-day/max-three sample. No callback URL or OAuth secret changed. The same structural distribution as Part 1 was revalidated; receipts are not asserted identical without persisted private identifiers.

| Evidence | Count |
|---|---:|
| Receipts / purchased lines | 3 / 3 |
| Quantity-one / completed-paid-empty-refund lines | 3 / 3 |
| Exact current active configuration matches | 1 |
| Compatible question mapping among those matches | 1 |
| Applicable resolved / normally eligible lines | 0 / 0 |
| Historical exact matches requiring adoption | 1 |
| Other lines without exact active mapping | 2 |
| Held lines | 3 |
| Intended current Order / line / Reading writes | 0 / 0 / 0 |
| Purchaser identity structurally present | 3 |
| Purchase selections / text answers / file inputs | 6 / 3 / 0 |

All transaction `is_digital=false` values remained false. Overlapping authoritative reasons were `unmapped_listing=3` and `ambiguous_historical_mapping=3`: these reflect unavailable applicable policy/question mapping, not six held lines or three unknown listing IDs. Only one timestamp-verified exact match is classified as adoption-required. No unsupported input or missing-evidence category was observed in this sample. No quantity>1/mixed-cart real acceptance is claimed.

Domain fingerprints were unchanged inside the read-only snapshot; no adoption/ingestion function was called. Snapshot equality is evidence of this execution, not proof against unrelated concurrent writers. Raw bodies and private identifiers/answers remained in memory only; durable evidence contains counts/categories. Refresh was the sole authorized credential-lifecycle mutation, not an Etsy commerce mutation.

## Remaining limits and explicit next approval

ETSY-E2E-01, ETSY-CARDINALITY-01 and ETSY-INPUTS-01 remain OPEN. Synthetic/native fixtures do not close real intake, quantity/mixed-cart, edited-question, dropdown/upload, refund/cancellation or downstream generation/review/PDF debts. Live purchaser provenance is currently dry-run evidence, not real persisted MRH ingestion evidence.

Before Part 2B, the user must explicitly approve **historical adoption and controlled ingestion of the single exact-matching historical candidate, using its specifically reviewed current ProductVersion, with no generation/delivery**. Then an authenticated owner must:

1. Re-fetch that selected owned receipt and revalidate its exact transaction/version, status, full mapped context and quantity; review the candidate privately without placing identifiers/PII in reports.
2. Submit `approveOwnedHistoricalLine` for only that receipt/transaction/version with a stable command UUID. Approval pins the current source fingerprint; changed source requires review, never automatic repair/rebinding.
3. Dry-run again. If still compatible and quantity one, the conditional intended cardinality is one Order, one line, one Reading. This is not a current eligible result.
4. Only under the separately granted live-ingestion authorization, submit `ingestOwnedReceipt` with a distinct stable command UUID and the exact approved version choices; replay and inspect counts/provenance without running workers.

No real MRH adoption, Order, Reading, generation, PDF or delivery was performed. Nothing was pushed/deployed. Part 2B was not started.
