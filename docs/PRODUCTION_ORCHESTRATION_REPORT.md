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


## PART 2 — SCHEDULING + CLAIMING

Date: 2026-10-06. Branch verified: `codex/ui-ux-design-lock`. HEAD before edits was the exact required Part 1 base `8d6238972d40b871ea37d3cb4fbbae3517f62d2b`; its generation predecessor was also verified. Working tree was clean. This section reports Part 2 only; the preceding section remains the historical Part 1 report.

1. **Queue lifecycle:** QUEUED, CLAIMED and terminal SKIPPED. A safe expired CLAIMED item can receive a new claim token after revalidation. No executed/completed/provider-retry state is fabricated.
2. **Schema/migration:** additive `0007_unknown_dreadnoughts.sql`; same queue table and 25-table database. Six nullable columns: claim token, claimed time, expiration, scheduling ordinal, resolved time/code. Unique active-token index and state/expiration index; complete null-sensitive metadata checks; handwritten transition guard added while retaining exact policy/ownership/immutability guards. Existing rows/bindings survive and acquire null metadata.
3. **Scheduling:** centralized pure comparator: aged band, near/overdue deadline band, Express, Standard; deadline band uses earliest deadline first, then all bands use oldest createdAt and lexicographic UUID. Defaults reside in production/scheduling.ts, not multiple call sites.
4. **Deadline behavior:** target deadline remains purchase-derived Part 1 policy. Deadline ≤ now + 15 minutes enters urgent band, overdue first. Distant deadlines keep ordinary class/age rank. Exact threshold tests are deterministic.
5. **Aging:** wait ≥ 120 minutes moves even Standard ahead of newer urgent/Express work, then FIFO/ID. This bounds overtaking by fresh arrivals with a finite older backlog and progress; repeatedly expiring oldest unexecuted work still needs later lifecycle handling.
6. **Fairness:** least-recently-served Store using max persistent scheduling ordinal across retained queue history; unserved is zero. Equal turns use best work rank/Store ID. At most one claim per Store per cycle. Claims AND stale resolutions advance turns, so a stale-heavy Store cannot perpetually retain first position. Per-Store inspections are also capped by floor(global budget / candidate Store count), minimum one. Batch-size-one fairness persists across cycles/processes.
7. **Claim algorithm:** ProductionScheduler.claimProductionWork opens a short PostgreSQL transaction, acquires a dedicated advisory transaction lock, reads DB clock/metadata, schedules, locks Store then queue row, rechecks state/expiry/current eligibility, persists token/times/ordinal and commits before returning claims. Multiple caller results are disjoint; no process mutex.
8. **Batch/concurrency boundary:** server `PRODUCTION_CLAIM_BATCH_SIZE`, default 4, range 1..100; max inspected 100 by default. One per Store per cycle can underfill a batch. This is a claim-per-cycle bound, not actual generation concurrency or a total active-claim cap. No execution loop is installed.
9. **Expiration/reclaim:** default 120 seconds. Expiry is inclusive and uses DB time by default; tests inject a deterministic clock. An expired safe claim rotates token/time/turn; nonexpired claims cannot be stolen. Any existing Generation fences reclaim; no AI attempt is reset. Part 3 must introduce external-boundary fencing and accounting-aware recovery before dispatch.
10. **Stale resolution:** existing Generation and normalized admission holds resolve as SKIPPED with reason/time, retained binding/history and a redacted system audit. No deletion, repeated poll audit, AIRequest or provider call. Terminal intents are not resurrected automatically by Part 1 reconciliation.
11. **Manual coordination:** successful/processing/failed Generation already present excludes new selection. A test manually prepares with a deterministic fake BEFORE scheduling and confirms no later duplicate request. Manual preparation may begin after a claim commits; Part 3 must revalidate/fence immediately before execution. GenerationService/gateway idempotency semantics were not changed.
12. **Internal authority:** explicitly trusted server factory requires server Database possession and accepts no seller Scope/session/browser credentials. No seller impersonation, HTTP/action endpoint or client export. Deterministic context readers are separated from authorized seller wrappers; existing seller authorization remains required. Paid worker authorization is expressly deferred to Part 3.
13. **Transactions/locking:** advisory lock serializes only scheduler cycles; Store-first and queue-second locks coordinate intake/setup/corrections/manual preparation. No network wait inside transactions. Unexpected persistence failure rolls back the cycle. No future claim is an external-execution authorization.
14. **Tenant/security:** queue composite ownership and immutable policy triggers remain; every selected Store is verified from persisted identity and mutations are scoped. Cross-tenant seller read selectors/forged scope still fail; internal scheduling claims preserve exact Store/organization IDs. Returned claims contain queue metadata only, no customer/style/generated bodies.
15. **Tests added:** 5 unit tests plus 24 database tests. Coverage includes bands/thresholds/ties/config limits, durable claim, concurrent disjoint claims/token exclusion, batch/per-Store bounds, persisted fairness, stale-heavy inspection fairness, quantity/mixed cart, no-session worker boundary, hold/Generation stale resolution, manual preparation, expiry exact boundary, existing Generation reclaim fence, transition constraints, rollback, populated Part 1 migration preservation, database priority/deadline/aging integration and explicit no-generation/gateway/provider/fetch/accounting side effects.
16. **Total tests:** 189 across 17 files: 54 unit/security across 10 files, 135 database across 7 files. All 160 Part 1 tests remain passing. The old queue-migration test selects only the queue ID when intentionally testing a pre-Part-2 schema; original preservation/empty-queue assertions remain unchanged.
17. **Validation:** `pnpm typecheck` PASS; `pnpm test` PASS (54); `pnpm test:db` PASS (135); `pnpm build` PASS (optimized Next webpack compile, TypeScript, routes and traces). Next-generated config additions restored; original strict configuration typecheck rerun successfully. `pnpm db:generate` reports no pending schema changes. No dependency changes or seller UI edits.
18. **Migration/replay/fixtures:** real PostgreSQL-engine PGlite migration runner applies and replays migrations 0000–0007. Populated Part 1 queue preservation test verifies old values plus null new fields. Existing equivalent fixture seed/replay stays six orders/seven lines/ten readings, including #2002 two lines, quantities 2+1 and three independent readings. No migration-time queue execution or historical generation assignment.
19. **Native PostgreSQL:** attempted isolated `initdb -D /tmp/reading-os-production-part2-pg -A trust --no-locale -E UTF8`; blocked at `shmget: Operation not permitted`, partial cluster removed by initdb. Native application/replay/fixture CLI and multi-connection lock acceptance NOT executed. PGlite concurrency tests use concurrent application calls and do not establish native multi-process locking acceptance. No production database accessed.
20. **Limitations:** metadata scan remains unpaginated; short scheduler cycles serialize globally and may block briefly on Store locks. Batch cap is not a global execution-concurrency quota. Fairness is relative service order, not weighted/deadline-optimal scheduling or an SLA. Skipped work needs a future explicit resume policy. No worker execution, remote-worker authentication, token-ack protocol, rate limiting, provider retry/backoff or ambiguous AI recovery. Native acceptance and UI rendering unverified (no UI edits). Queue/generation post-claim race must be fenced in Part 3.
21. **Exact changed files:** complete Part 2 list below; prior migration SQL and ProductVersion/Generation records are untouched.
22. **Commit:** local Part 2 commit on the verified branch. Exact hash is supplied in the task response and obtainable via `git log -1`; this report is part of that commit. No push/deploy claimed.
23. **Exact PART 3 handoff:** use ProductionScheduler for bounded durable claims and shared admission readers. Add explicit trusted paid-worker authorization, additive execution lifecycle/token fencing, stable persisted queue-to-Generation command binding, and last-moment manual/hold/context revalidation. Invoke the existing accounted GenerationService only after durable authorization/claim commit. Preserve ambiguity/accounting state, never infer safe paid retry from claim expiration. Terminal resolution/resume policy, outcome linkage and stale-worker acknowledgment must be designed in the authorized execution slice. Do not begin provider retry/backoff, full abandoned AI recovery or Part 4 implicitly. No Review Workspace/PDF/delivery/Telegram/billing.

### Exact Part 2 files changed

- .env.example
- AGENTS.md
- README.md
- docs/ARCHITECTURE.md
- docs/EDGE_CASES.md
- docs/PRODUCTION_ORCHESTRATION.md
- docs/PRODUCTION_ORCHESTRATION_REPORT.md
- docs/PRODUCT_SPEC.md
- drizzle/0007_unknown_dreadnoughts.sql
- drizzle/meta/0007_snapshot.json
- drizzle/meta/_journal.json
- src/db/schema.ts
- src/modules/generation/context.ts
- src/modules/intake/service.ts
- src/modules/production/scheduler.ts
- src/modules/production/scheduling.ts
- src/modules/seller-style/context.ts
- src/modules/seller-style/service.ts
- tests/production-scheduling.db.test.ts
- tests/production-scheduling.test.ts
- tests/production.db.test.ts

### Boundary confirmation

Scheduler implementation imports no GenerationService, CentralAIGateway or GenerationProvider and creates no Generation/AIRequest/UsageEvent. Explicit tests spy on all those invocation boundaries and global fetch. The manual coordination test uses one fake provider outside the scheduler to establish prior work; this is not a live-provider call. Part 3 has not begun.

## PART 3 — EXECUTION + SETTLEMENT

Date: 2026-10-06. Branch: `codex/ui-ux-design-lock`. Verified clean starting HEAD/history contains required base `0e5a36081403f9c2970cd2397488e5ed5617cadd`. Completed locally; no push/deployment. The completion commit includes this report; its exact hash is returned in the final response and available in local Git history.

1. **Execution lifecycle:** QUEUED→CLAIMED→EXECUTING→COMPLETED/ATTENTION. Existing SKIPPED is pre-execution terminal history. No RETRY_WAIT or automatic retry lifecycle. EXECUTING is not reclaimable.
2. **Schema/migration:** additive `0008_thankful_marvex.sql`, Drizzle snapshot/journal. Three nullable columns: generation_command_key, generation_id, execution_started_at. Expanded lifecycle checks, owned command uniqueness, composite Generation FK, exact Reading/ProductVersion association, immutable execution bindings/terminal states, active-claim transition guard. 25 existing tables retained; no new table, historical mutation or fabricated execution.
3. **Trusted boundary:** ProductionExecutor requires trusted server Database and GenerationService. Store/Reading identity comes from locked queue state. Frozen issuer-authenticated capability cannot be serialized/forged by a browser. Normal owner-authorized seller path remains intact; no impersonation, HTTP route or server action added.
4. **Stable identity:** queue UUID is the persisted generation command UUID, committed before dispatch. Restart/replay retains that identity and never creates a new paid command. Queue association commits with Generation/AIRequest/provisional UsageEvent admission.
5. **Final fence:** Store→queue locking; current CLAIMED/token/unexpired DB clock; existing Generation exclusion; shared production context checks for holds/customer/configuration/profile/style; retained ProductVersion and ASSISTED policy. Deterministic stale work becomes SKIPPED with zero new Generation/AIRequest/UsageEvent.
6. **Token fencing:** wrong/expired/replaced pre-execution token cannot dispatch; stale acknowledgement cannot mutate newer work. EXECUTING cannot rotate/reclaim. Terminal states retain token for fenced idempotent acknowledgement, clearing expiry. Incurred outcome can settle after dispatch expiry.
7. **Engine integration:** dedicated GenerationService.prepareProduction delegates to the existing pipeline. Prompt assembly, canonical validation, snapshots, budgets/provider policy and gateway accounting are reused. Production execution does not import or call CentralAIGateway/GenerationProvider directly.
8. **Cycle:** explicit runProductionCycle plus productionRuntime(db).runCycle; claims a bounded set, executes after scheduler commit, returns compact statuses/references. No infinite loop, recurring schedule, cron or deployment daemon.
9. **Concurrency:** sequential execution per cycle. Existing batch limit/per-Store fairness retained. Multiple cycles are not a distributed provider-concurrency cap. Later sequential claims may expire and return STALE_CLAIM without dispatch.
10. **Success:** referenced persisted SUCCEEDED Generation settles COMPLETED/SUCCEEDED, retains canonical source and clears expiry; queue never copies bodies. Success return-path interruptions can acknowledge canonical state without paying again.
11. **Known failure:** FAILED Generation settles ATTENTION/GENERATION_FAILED. Admission/interruption with no admitted request settles ATTENTION/PREPARATION_BLOCKED; accounting-before-dispatch proves no provider invocation. No automatic retry.
12. **Ambiguity:** ambiguous request or interrupted admitted external work settles ATTENTION/OUTCOME_UNCERTAIN with preserved request/usage/cost liability. Hard crashes can remain EXECUTING/PROCESSING/RUNNING. Replay never redispatches unfinished intent. Unknown remains null/unknown, never zero.
13. **Stale worker:** queue/Store locks and token comparison fence settlement. acknowledgements read persisted outcomes only; unfinished EXECUTING returns IN_PROGRESS. Mismatched token returns STALE_CLAIM and cannot overwrite newer claims/terminal results.
14. **Manual race:** shared Store lock plus existing per-Reading Generation exclusion permits only one new initial request. Manual win before execution fence skips queue. Manual win in fence→engine admission gap settles blocked attention without duplicate work; canonical manual success remains authoritative. Manual mode itself is unchanged.
15. **Accounting:** one gateway path creates AIRequest/provisional UsageEvent before provider dispatch and settles existing exact USD nanos/pricing snapshot. Paid-model test double verifies failed attempt's 825000 estimated nanos and preserved usage. Settlement-failure test preserves RUNNING unknown/null accounting and proves no redispatch. No paid/live provider is used by tests.
16. **Seller projection:** scoped queue metadata supplies Waiting→Preparing; canonical success supplies Ready for review; ATTENTION supplies Problem. Existing hold/customer-revision warnings retain precedence. Processing content whose queue needs attention shows support guidance rather than an inaccurate ongoing-preparation message. No infrastructure terminology, controls or visual redesign added.
17. **Security/privacy:** tenant-scoped seller reads and composite ownership remain. Internal identity derives only from durable queue. Audit actions for skip/completion/attention contain owned resource metadata/null system actor, no raw prompt/customer/style/content/secret/error logging. No poll noise. Capability membership is authenticity only; concurrency remains PostgreSQL-backed.
18. **Tests added:** 27 isolated PostgreSQL-engine execution tests and one architecture boundary test (28 new). Cover canonical/accounting integration, reload/projection, stable replay/restart, concurrent dispatch, active/wrong/expired/replaced token, final holds/customer/setup fences, manual race and its admission gap, exact retained version/current snapshots, known/ambiguous/interrupted paid outcomes, terminal history guards, mixed cart/quantity, Manual preservation, scoped denial, batch/sequential Store ownership and populated Part 2 migration preservation. Existing assertions were not weakened.
19. **Total:** 217 tests: 55 unit/domain/security in 11 files + 162 database/integration in 8 files. Prior 189 remain green. Deterministic fake providers only; zero external AI calls.
20. **Commands:** pnpm typecheck PASS; pnpm test PASS (55); pnpm test:db PASS (162); pnpm build PASS. Next-generated tsconfig/next-env changes restored so no unrelated config churn remains.
21. **Migration/replay:** Drizzle PGlite migration runner application and replay PASS including migration 0008. Populated waiting/claimed Part 2 rows retain original metadata and null execution bindings. Fixture seed/replay PASS: six orders, seven lines, ten independent readings, mixed cart #2002 Love×2 + Career×1 retained; no fabricated Generation.
22. **Native PostgreSQL:** attempted isolated `initdb -D /tmp/reading-os-part3-pg -A trust --no-locale -E UTF8`. BLOCKED during bootstrap: `could not create shared memory segment: Operation not permitted`, failed `shmget(key=76896492, size=56, 03600)`. No native server/database was available for acceptance, and no production database was accessed. PGlite validates PostgreSQL engine behavior but is not a native multi-process/socket concurrency acceptance.
23. **Limitations:** no automatic abandoned-AI recovery, retry/backoff, rate limiting, distributed concurrency cap, recurring runtime, live provider acceptance or new browser journey. Application/database acceptance uses synthetic tests, including seller status/reloaded content, rather than claiming a live UI/provider run. EXECUTING can remain indefinitely after a hard crash; SKIPPED/ATTENTION are terminal until future explicit policy. Existing metadata scan scaling and live-intake/privacy/deployment gates remain.
24. **Exact files changed:** listed below; no dependency/lockfile/provider/pricing/product-policy changes.
25. **Commit:** local completion commit contains this report and all files below; full hash supplied in final response. Nothing pushed or deployed.
26. **Exact PART 4 handoff:** preserve stable execution command, queue history, Store-first/token fences, shared admission and gateway accounting. Define explicit known-failure retry/resume/adoption and durable new-attempt identity; do not reuse ATTENTION as fresh paid work. Inspect abandoned/unknown external operations conservatively before any approved recovery; lease expiry never proves retry safety. Preserve unknown liabilities and attempt history. Runtime/deployment, global concurrency/rate control and any retry policy require the next bounded authorization. Do not infer PDF/delivery/review/billing scope. Part 4 has not begun.

### Exact changed files

- AGENTS.md
- README.md
- docs/ARCHITECTURE.md
- docs/EDGE_CASES.md
- docs/GENERATION_ENGINE.md
- docs/PRODUCTION_ORCHESTRATION.md
- docs/PRODUCTION_ORCHESTRATION_REPORT.md
- drizzle/0008_thankful_marvex.sql
- drizzle/meta/0008_snapshot.json
- drizzle/meta/_journal.json
- src/app/(operations)/orders/[id]/page.tsx
- src/components/generation/reading-preparation.tsx
- src/components/seller-status.ts
- src/db/schema.ts
- src/infrastructure/ai/gateway.ts
- src/modules/generation/authority.ts
- src/modules/generation/service.ts
- src/modules/intake/service.ts
- src/modules/production/execution.ts
- src/modules/production/runtime.ts
- tests/production-boundary.test.ts
- tests/production-execution.db.test.ts
