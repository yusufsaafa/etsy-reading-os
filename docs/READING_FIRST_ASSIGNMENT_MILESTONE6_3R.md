# Milestone 6.3R — controlled first configuration assignment

## Repository and preservation

Repository: `yusufsaafa/etsy-reading-os`, local checkout:
`/Users/yusufsafakilic/.codex/.chatgpt-projects/g-p-6ac38d2133b08191a7f586ecfca5ff59/etsy-reading-os`.
Branch: `codex/ui-ux-design-lock`. HEAD: `034c111bddd9f0ff870f5a7b54118a1143a403cb`.
The required base is HEAD. Existing uncommitted Milestone 6.3 capture and webhook acceptance work was verified before implementation and preserved. Initial tracked diff: 21 files, 296 insertions, 46 deletions, plus existing untracked capture/acceptance documentation, runner scripts and webhook tests. No commits, pushes or deployments. No native database access, live Etsy calls or AI operations.

## Before and after

Before: eligible unconfigured purchases were durably captured and visible, but `UNIT_CONFIGURATION_IMMUTABLE` prevented later binding.
After: an owner can explicitly approve one published configuration for a single existing unconfigured Reading. Existing IDs, quantity index, purchased line snapshot, raw personalization evidence and all customer input rows/revisions remain unchanged. The repository names the configured state `versioned`; the transition is `unconfigured / NULL` → `versioned / ProductVersion`.
Publication alone never recovers a Reading. No automatic adoption of today's active version occurs. Archived published versions are also eligible when their immutable policy matches the saved purchase. Confirmation explicitly approves that version for that purchase, including purchases before publication; matching title or SKU cannot authorize assignment.

## Migration and exact trust boundary

`drizzle/0029_reading_first_assignment.sql` adds an append-only `reading_configuration_assignments` table, bounded source evidence, owned foreign keys, unique unit and command keys, validation/application triggers and canonical purchased-option identity comparison. The journal registers migration 0029. The original 0023 insertion protection remains unchanged.

The application authenticates through `currentScope`, derives Store scope server-side and requires owner membership. `assignReadingConfiguration` is the authoritative application command. It validates the published configuration using existing configuration/activation contracts and source assessment, takes Store then unit locks, inserts the approval record, updates attention issues using the pinned configuration and writes an audit event in one transaction.

SQL independently verifies owner membership, owned Store/unit/line/order/version relationships, null/unconfigured first state, current revision, payment/source holds, saved evidence equality, shop/receipt/transaction identity, quantity/index, historical purchase timestamp, exact listing/options, corroborating product-data identities, unpaused product mapping, published version and unambiguous supported input identities. Assignment cannot coexist with generation/queue work. The append-only record's AFTER INSERT trigger applies only the two binding fields.

The revised unit trigger permits that transition only when the corresponding owned validated approval exists and every other unit field is unchanged. Every subsequent version/state mutation still raises `UNIT_CONFIGURATION_IMMUTABLE`. Approval update/delete is rejected. There is no session bypass flag, disabled trigger or security-definer privileged procedure.

As in existing repository services, authenticated actor identity is supplied by the trusted application database connection. SQL validates that actor's membership but cannot authenticate a forged web session from someone holding unrestricted database credentials. Database administrators capable of altering tables/triggers are outside this boundary. Direct SQL through the normal role still cannot make an invalid binding merely by skipping application validation; it must satisfy the approval trigger. Published configuration readiness continues to rely on existing publication invariants plus application validation; generation independently revalidates its full context.

## Seller flow and generation

Orders → Order Detail → unconfigured Reading → review Purchase Information → Assign first reading configuration → select an eligible saved version → confirm immutable first assignment. When no candidate is safe, an actionable reason and the existing Products link are shown. Candidate previews include version, archive status, sections, input fields, output and purchase-before-publication warning.

Assignment does not queue or run generation. Recovered Readings also remain excluded from automatic ASSISTED production admission after customer saves, intake replay and production reconciliation. Seller-controlled Prepare reading uses the existing generation engine and all existing admission checks.

An untouched empty Etsy revision-zero input can be read through the explicitly pinned source policy, without updating its input row. Seller revisions and corrections remain authoritative. Missing buyer information, quantity allocation, source drift, style/product/AI readiness and other existing holds continue to block generation.

## Idempotency and concurrency

Store/unit row locks serialize confirmations. A replay of the same successfully assigned version returns `ALREADY_ASSIGNED` without changing history or creating another approval. A different version returns `ASSIGNMENT_CONFLICT`; command reuse for another assignment returns `COMMAND_CONFLICT`. Unique constraints and the SQL state checks prevent duplicate approvals or replacement bindings. Binding, approval, attention recomputation and audit insertion commit or roll back together. PGlite tests exercise concurrent application promises; native multi-connection PostgreSQL timing has not been exercised.

## Files introduced or extended for 6.3R

New: migration 0029, `src/modules/orders/assignment.ts`, `src/components/reading-recovery.tsx`, `tests/reading-assignment.db.test.ts`, `tests/reading-recovery.test.ts`, this report.
Extended: migration journal, schema, Orders actions/detail page, order operation copy, product runtime input projection, intake replay triage, generation context and production admission. Older webhook/intake capture changes are retained, not attributed to this milestone.

## Verification

All database tests use disposable in-memory PGlite instances and apply migrations only there. Tests cover first assignment, replay/conflicts, concurrent attempts, tenant isolation, wrong listing/options, drafts, missing evidence, SQL enforcement, immutable winning versions, purchased evidence and quantity identity, customer revisions, generation before/after, no AI/queue writes, payment/source/mapping/input identity holds and corroborating product data. Existing configured generation, webhook idempotency, polling overlap, historical adoption and connection epoch behavior are exercised by expanded regression suites.

Commands:

```sh
pnpm test:db tests/reading-assignment.db.test.ts
pnpm test tests/reading-recovery.test.ts
pnpm test tests/orders-refinement.test.ts tests/order-operations.test.ts tests/generation.test.ts tests/generation-integration.test.ts tests/production-boundary.test.ts tests/production-recovery.test.ts tests/etsy-webhook.test.ts tests/etsy-webhook-route.test.ts tests/etsy-normalizer.test.ts tests/automatic-intake.test.ts tests/etsy-webhook-digest.test.ts
pnpm test:db tests/etsy-controlled.db.test.ts tests/etsy-webhook.db.test.ts tests/etsy-source.db.test.ts tests/etsy-historical.db.test.ts tests/intake.db.test.ts tests/generation.db.test.ts tests/production.db.test.ts tests/production-recovery.db.test.ts tests/production-scheduling.db.test.ts tests/production-execution.db.test.ts tests/orders-list.db.test.ts tests/etsy-setup-catalog.db.test.ts
pnpm typecheck --incremental false
git diff --check
```

Focused recovery: 20/20 passed. UI rendering: 2/2 passed. Expanded unit regressions: 219/219 passed across 11 files. Full typecheck and whitespace checks passed. Expanded PGlite database regressions: 376/376 passed across 12 files (300 seconds). Total: 617 relevant tests passed. Migration journal application/replay passed within those suites.

## Acceptance

**PASS** for the defined implementation and isolated-test acceptance criteria. No automatic AI operation occurs. Live/native rollout remains unperformed, as required.

## Remaining boundaries and immediate next step

No implementation blocker remains for supported retained text purchases with exact listing/option identity and a valid saved version. Incomplete historical evidence, unresolved uploads/dropdowns, ambiguous fields/options, paused mappings, payment/source-change holds and absent eligible versions remain safely blocked. Candidate lookup is bounded to 50 matching saved versions; very old versions beyond that window may require a separately designed bounded selector.

Not verified: native PostgreSQL rollout, separate-connection concurrency, authenticated interactive browser flow and live Mystic Reading House purchase acceptance. Runtime here is Node 20.16.0 while package engines require >=22.12.0; tests and typecheck run successfully with an engine warning. No production migration was applied.

Immediate next milestone: on supported Node, review/apply migration to a separately authorized disposable PostgreSQL acceptance environment, exercise two connections and the authenticated seller flow, then perform a separately authorized controlled Mystic Reading House purchase with explicit configuration and generation confirmation. Do not apply this migration to either named native database as part of this milestone.
