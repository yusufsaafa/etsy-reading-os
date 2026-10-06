# Production orchestration report

## PART 1 — FOUNDATION + ADMISSION

Date: 2026-10-05. Branch: `codex/ui-ux-design-lock`. Base: `02f47d6cd8fefea3ae3c6874e98d4ebfdb880e73`. Completed as a local commit; no push or deployment. The exact completion hash is returned in the task response and available through `git log -1` (this report is included in that commit).

1. **Production policy:** existing version-owned workflow is the single automation source. MANUAL stays seller-started; ASSISTED admits eligible waiting work. No automatic delivery semantics. AUTOMATIC remains unsupported.
2. **Fulfillment policy:** optional version-owned Standard/Express priority and nullable bounded integer target minutes. Default for old configurations is Standard/no target. Target deadline derives from retained purchase time plus duration; no sorting or timing promise.
3. **Compatibility:** historical ProductVersions and Generation contexts are not rewritten. Draft edits publish new immutable versions; historical readings retain their original version/automation/urgency. Migration does not assign current styles or fabricate work history.
4. **Queue schema:** one new 11-column `production_queue` table; QUEUED only, owned reading/version, priority/duration/deadline, timestamps. 25 tables total. No claims, leases, worker fields, attempts or execution history. Unique owned reading identity, composite foreign keys, checks and handwritten exact-bound-policy/immutability trigger.
5. **Admission:** production/service.ts exposes owner-authorized `admitReading` and an internal transaction boundary. Durable insert plus redacted audit are atomic with relevant mutation. No Generation, AIRequest, UsageEvent or model call is created during admission.
6. **Eligibility reuse:** `buildGenerationContext` reuses the existing bound product/customer/triage/seller/style rules. Paid generation's default owner requirement and GenerationService/gateway behavior are unchanged. The sole context reader extension lets trusted intake transactions verify member permission for admission without granting paid-operation permission. Any existing Generation excludes a new automatic initial intent.
7. **Idempotency/concurrency:** Store PostgreSQL row lock serializes admission against existing mutations/manual generation. Store/reading uniqueness and conflict convergence protect repeated/concurrent commands; no frontend or process-local mutex dependence. The concurrency test uses six concurrent application calls in PGlite; native multi-connection locking remains unverified.
8. **Reconciliation:** explicit Store-owner command finds missed eligible ASSISTED readings and only inserts missing waiting work. Replay returns zero newly queued. Intake/corrections auto-admit transactionally; seller profile/style and mapping-hold changes reconcile within their existing locked transactions. No page visit, recurring schedule or worker is required.
9. **Security:** authorized Store scope, owned reading lookups, cross-tenant read/mutation rejection, composite relationships and exact retained-policy trigger. Existing intake operators can admit via authorized correction transactions, but cannot invoke owner-only admission/reconciliation commands. Audits contain resource/actor/tenant metadata only.
10. **UI:** existing Product Setup gains Manual/Automatically prepare labels and compact Standard/Express/optional target-minutes controls. Copy truthfully explains execution is deferred and sending remains separate. No other screen redesign or infrastructure controls.
11. **Migration:** additive `0006_small_rattler.sql`, generated snapshot/journal plus handwritten policy trigger. Empty queue after migration; eligible historical Assisted work is enrolled by reconciliation rather than data-migration side effects. Drizzle generation reports no further schema changes.
12. **Tests added:** 16 database tests cover old Manual/Assisted, policy validation/deadline, historical version preservation, automatic intake/correction/setup/resume admission, missing inputs/profile/style/product, holds, successful Generation exclusion, replay/concurrent audit uniqueness, reconciliation, mixed carts/quantity, cross-tenant and DB forgery, intake rollback, additive migration preservation and operator authorization. Existing pre-generation migration fixture construction suppresses only the new admission hooks while using the old schema; all original preservation assertions remain unchanged.
13. **Total tests:** 160 tests across 15 files: 49 unit/security tests across 9 files and 111 database tests across 6 files. All prior 144 tests remain passing; Generation Engine's 37 database tests remain green. Admission performs zero external AI calls.
14. **Validation:** `pnpm typecheck` PASS; `pnpm test` PASS (49); `pnpm test:db` PASS (111); `pnpm build` PASS (optimized Next webpack compilation, TypeScript, routes and traces). Build-generated next-env/tsconfig changes were restored to retain original strict project configuration; typecheck was rerun after restoration. No dependency changes.
15. **Migration/replay and fixtures:** PGlite PostgreSQL migration runner application and replay PASS, including migration 0006. New additive migration test preserves prior rows and creates no queue entries. Existing equivalent fixture seed/replay PASS with six orders, seven lines, ten readings; mixed order #2002 remains two lines with quantities 2+1 and three independent readings. Native isolated PostgreSQL `initdb -D /tmp/reading-os-production-part1-pg -A trust --no-locale -E UTF8` was attempted and FAILED at `shmget: Operation not permitted`; it removed its partial cluster. Native migration/replay and the native CLI fixture seed could not run. No production database was accessed.
16. **Known limitations:** Part 1 does not execute work. QUEUED rows can remain after later holds/manual preparation; future execution must revalidate and resolve/skip them. Reconciliation and setup-transition scans are Store-scoped but not paginated. Native multiple-connection concurrency, native acceptance and browser rendering were not validated. Existing privacy/retention and live Etsy gates remain. No automatic retry or unknown-provider-outcome recovery is introduced.
17. **Exact files changed:** see the complete list below.
18. **Commit:** local Part 1 commit only; hash in final response / `git log -1`. Base remains the generation milestone commit noted above.
19. **PART 2 handoff:** use durable production intents and existing admission service. Under the next bounded authorization, design additive execution lifecycle, coordinate already completed/manual work, establish worker authorization and a stable GenerationService command identity, and revalidate live eligibility before dispatch. Preserve generation/accounting/ambiguity guarantees. Bind current seller/style/customer snapshots in Generation at execution admission, while retaining queue-bound product policy. Claims/leases/scheduling/retry/recovery belong only to the explicitly authorized subsequent slices. Do not assume all later work is authorized by Part 1.

## Exact files changed

- AGENTS.md
- README.md
- docs/ARCHITECTURE.md
- docs/EDGE_CASES.md
- docs/PRODUCT_CONFIGURATION.md
- docs/PRODUCT_SPEC.md
- docs/UI_UX_DESIGN_LOCK.md
- docs/PRODUCTION_ORCHESTRATION.md
- docs/PRODUCTION_ORCHESTRATION_REPORT.md
- drizzle/0006_small_rattler.sql
- drizzle/meta/0006_snapshot.json
- drizzle/meta/_journal.json
- src/components/products/editor.tsx
- src/db/schema.ts
- src/modules/generation/context.ts
- src/modules/intake/service.ts
- src/modules/products/contracts.ts
- src/modules/production/service.ts
- src/modules/seller-style/service.ts
- tests/generation.db.test.ts
- tests/production.db.test.ts

## Boundary confirmation

No queue execution, queue GenerationService invocation, scheduler, ordering/fairness algorithm, worker concurrency, claim/lease, retry/backoff, abandoned-work recovery, provider rate limiting, Review Workspace, PDF, delivery, Telegram or billing was implemented. Existing Etsy sync infrastructure is unchanged. Part 2 has not begun.
