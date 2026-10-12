# Milestone 6.3 — configuration-independent capture

Status: durable capture and seller attention implemented; first assignment/recovery remains blocked. No production deployment or live Etsy acceptance is claimed.

## Scope and repository

Branch `codex/ui-ux-design-lock`, base/HEAD `034c111bddd9f0ff870f5a7b54118a1143a403cb`.
Existing signing compatibility, Portal test acknowledgement, acceptance scripts, regression tests, integration documentation and tooling changes were retained. No commit, push, deployment, environment edit or native database operation.

## Capture versus preparation

Webhook and backup polling still use `syncOrderReceipt`. Safely projectable paid, non-canceled, non-refunded receipts with complete required source evidence can now be captured without an eligible configured line. Exact mapping/input/historical ambiguity remains a preparation hold instead of making the purchase disappear. The same Store-first receipt transaction creates all LineItems and quantity-indexed Readings. No ProductVersion is fabricated. Live capture continues to suppress production admission.

`ingestControlledReceipt` has an internal `captureUnconfigured` option, requiring a verified shop and connection epoch. The explicit controlled/historical command keeps its original eligibility gate when that option is absent. Approved-version checking, ownership, payment/source safety and receipt bounds remain intact.

Existing-order reconciliation retains original identities, snapshots, quantity, inputs and bindings. It still refuses incompatible line/quantity expansion. Worker transport retries remain bounded. Captured orders with unresolved holds return `PARTIAL` and settle to inbox `ATTENTION`; they do not retry endlessly. That inbox status can now coexist with a visible saved Order.

## Purchased evidence and seller UI

The strict purchased-line contract optionally retains the receipt transaction title, bounded to 1–1000 characters. Existing JSON snapshots store this field; no database migration is required. New purchases with unavailable titles say “Purchased title unavailable”; a current internal Product name is not substituted as purchase-time fact. Existing line titles remain frozen on replay. Generation/PDF approved titles still come from their original immutable ProductVersion.

Purchased selection IDs/display values, quantities, SKU and bounded supported buyer-input evidence continue to be retained. Original verified text is shown from purchased evidence in Purchase Information even when it has no approved internal input mapping. This display projection never supplies generation inputs or resolves buyer fields. Unsupported encodings retain the existing restricted metadata/holds; no raw payload or file-reference storage was added.

Orders and the existing Needs Attention filter include captured unconfigured purchases. Order Detail shows each independent Reading as Unconfigured, with saved-purchase/setup explanations and navigation to Products. Missing customer information, purchased-option ambiguity and source holds retain their existing separate explanations. Preparation also checks versioned configuration in its UI projection. Backend generation-context admission independently rejects null-version units before any AI operation.

## Recovery boundary

`drizzle/0023_dusty_ultron.sql` rejects changes to either `product_version_id` or `configuration_state` with `UNIT_CONFIGURATION_IMMUTABLE`. It permits approved initial insertion, not later assignment of an existing null-version unit. No trigger, schema, ProductVersion or historical binding was changed.

Later Product activation or intake replay does not reassign a captured unit. This milestone intentionally stops at capture and attention under the user's scope fallback. A follow-up must review an audited, idempotent first-assignment design that preserves unit IDs, customer revisions, purchased snapshots, quantity and all already configured bindings. Historical adoption remains explicit and cannot be replaced by today's active Product configuration.

## Future Simple/Professional integration

The approved modes and Professional-mode automatic fallback are future policy, not runtime automation in this slice. Both modes must use this same capture domain. Future preparation should reuse validated, tenant-owned immutable ProductVersions for exact listing/purchase selections, with durable source provenance and material-change invalidation. It must perform controlled first assignment before generation. No automatic product analysis, mode switch, AI calls, quota enforcement, billing, trial enforcement or new accounting ledger was introduced. Any future AI analysis must use CentralAIGateway and existing request/usage accounting.

## Live shop preparation and limits

No call to Mystic Reading House or either native PostgreSQL database was made. Existing worker enablement, webhook connectivity and provider/storage runtime configuration require separate controlled live acceptance. The first configured live purchase can continue through the existing manually authorized preparation/review/PDF path after payment/input/profile/style/configuration checks. A captured unconfigured purchase cannot proceed until the first-assignment milestone is complete.

Preserved safety boundaries include unknown shop/ownership, stale connection epoch, incomplete source identity, receipt bound, historical worker cutoff and payment/refund/cancellation guards. Legacy snapshots without the newly retained title can conservatively acquire a source_changed hold if a later receipt exposes title evidence; history is never overwritten. Browser interaction and native PostgreSQL acceptance were not performed. Local Node is 20.16.0 while the package requires >=22.12.0; do not treat these tests as acceptance on the supported production runtime.

## Verification

Focused unit/UI/normalizer regression command:

`pnpm test tests/etsy-normalizer.test.ts tests/order-sync.test.ts tests/order-operations.test.ts tests/orders-refinement.test.ts tests/seller-status.test.ts tests/etsy-webhook.test.ts tests/etsy-webhook-route.test.ts tests/etsy-webhook-digest.test.ts tests/etsy-webhook-status.test.ts tests/automatic-intake.test.ts tests/webhook-local-runner.test.ts tests/webhook-runner-diagnostics.test.ts`

Result: 12 files / 235 tests passed.

`pnpm typecheck --incremental false` and `git diff --check`: passed.

The earlier `pnpm typecheck:core` reported four auth user-ID errors in unchanged files. Its restricted include list omits `src/types/next-auth.d.ts`; full application typechecking includes that augmentation and passes. No unrelated auth/tooling change was made.

Expanded database regression results are recorded below after completion. These suites use isolated PGlite instances and synthetic fixtures; they do not connect to `etsy_reading_os` or `etsy_reading_os_webhook_test`.

Expanded database command:

`pnpm test:db tests/etsy-webhook.db.test.ts tests/etsy-controlled.db.test.ts tests/etsy-source.db.test.ts tests/etsy-historical.db.test.ts tests/intake.db.test.ts tests/orders-list.db.test.ts`

Result: 6 files / 178 tests passed. Coverage includes fully unmapped receipt capture, mixed carts, quantity indexes, exact option resolution, historical snapshots, webhook deduplication, polling/webhook overlap, configured generation contexts, unconfigured admission rejection, tenancy, missing personalization, immutable null-version bindings and connection epoch races. Earlier focused runs passed 84 unit tests and then 132 webhook/controlled database tests. Final selected suites total 413 passing tests. No production build/browser/native PostgreSQL/live-provider acceptance was run.

## Files changed by this milestone

- `src/modules/orders/sync.ts`
- `src/modules/etsy/controlled-intake.ts`
- `src/modules/etsy/raw-normalizer.ts`
- `src/modules/etsy/source-contract.ts`
- `src/modules/orders/purchased-choices.ts`
- `src/modules/orders/operations.ts`
- `src/app/(operations)/orders/[id]/page.tsx`
- `src/components/order-detail.tsx`
- `tests/etsy-controlled.db.test.ts`
- `tests/etsy-webhook.db.test.ts`
- `tests/etsy-normalizer.test.ts`
- `tests/orders-refinement.test.ts`
- `docs/UNMAPPED_CAPTURE_MILESTONE6_3.md`

Initial tracked modifications were the integration document, next-env.d.ts, webhook-digest/intake/receiver, three webhook test files and tsconfig.json (9 files, +210/-18). Initial untracked work was WEBHOOK_LOCAL_ACCEPTANCE.md, scripts/acceptance/webhook/, etsy-webhook-status.test.ts, webhook-local-runner.test.ts and webhook-runner-diagnostics.test.ts. These were not altered by this milestone.

Final acceptance: PARTIAL. Durable capture, seller visibility, quantity/idempotency, generation rejection and immutable history pass the selected tests. Safe assignment and end-to-end recovery remain incomplete, as expressly permitted by the task's scope fallback. Immediate next milestone: controlled first assignment of an existing unconfigured Reading, preserving its stable identity and original evidence. Complete that before testing an unmapped MRH purchase through generation/PDF.
