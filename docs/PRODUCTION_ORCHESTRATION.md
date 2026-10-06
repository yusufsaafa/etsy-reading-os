# Production orchestration

## PART 1 — FOUNDATION + ADMISSION

Implemented on `codex/ui-ux-design-lock`, based on generation commit `02f47d6cd8fefea3ae3c6874e98d4ebfdb880e73`. This part stores eligible waiting work only. No production worker runs and no queue item invokes GenerationService or a provider.

## Inspection and policy

The base already has immutable ProductVersion JSONB configuration with `workflow: MANUAL | ASSISTED | AUTOMATIC | null`, per-reading immutable product binding, customer revisions, deterministic triage, Store-row locking, one seller profile/published style, and the generation context admission boundary. BackgroundJobs/PostgresSyncJobs is Etsy synchronization infrastructure with its own leases and retries; those fields/algorithms are not copied into production. No production queue existed. Existing Generation/AIRequest/UsageEvent and temporary manual Prepare reading remain intact.

Reuse `workflow` as the single production automation source rather than adding a competing automation column:

| Version workflow | Production meaning |
| --- | --- |
| MANUAL | Seller starts preparation manually; never auto-admitted |
| ASSISTED | Reading OS durably admits eligible readings for preparation; execution comes later |
| AUTOMATIC / null | Unsupported for production activation/admission |

ASSISTED has no delivery or delivery-approval meaning. Existing configurations stay byte-for-byte unchanged. No migration rewrites old versions or Generation snapshots. `productionPolicy` resolves absent fulfillment settings to Standard/no target. The structured optional `fulfillment` value belongs inside ProductVersion configuration: `priorityClass: STANDARD | EXPRESS`, `targetCompletionMinutes: integer 1..525600 | null`. Express does not require an arbitrary fixed duration; either class may have a seller-defined target. Targets are measured from the retained purchase time, not queue admission time. They can already be overdue after late customer clarification. This is planning data, not a timing guarantee or sorting algorithm.

Editing clones a draft using the existing service. Published versions and historical reading bindings remain immutable. Old Manual/Assisted configurations parse identically; defaults are resolved when needed rather than written into historical JSON. Seller UI adds Standard/Express and an optional target-minutes field in existing Product Setup controls. It labels production Manual/Automatically prepare and explicitly says automatic execution is not available yet. No Orders/Home redesign, provider settings, raw IDs or calculated deadlines are exposed.

## Durable waiting schema

Additive migration `0006_small_rattler.sql` adds one `production_queue` table (25 tables total):

| Field | Purpose |
| --- | --- |
| id, organization_id, store_id | Durable identity and tenant ownership |
| unit_id | One individual purchased reading, never the receipt |
| product_version_id | Exact production recipe bound at intake |
| state | QUEUED only in Part 1 |
| priority_class, target_completion_minutes | Bounded generic urgency copied from retained recipe |
| target_deadline | Purchase time + target minutes, or null |
| created_at, updated_at | Admission timestamps; no worker lease/claim timestamps |

Unique `(organization_id, store_id, unit_id)` permits one initial production item per reading. Composite foreign keys enforce owned reading/version references. A handwritten trigger additionally requires the exact reading-bound published ProductVersion, ASSISTED policy, matching priority/duration and matching purchase-based deadline. It protects ownership/bindings/urgency/created time against updates. Retain this trigger across later Drizzle changes; generated snapshots do not describe triggers. There is no generated content, prompt, customer answer, seller identity snapshot or style snapshot in the queue.

The item binds production policy, not future generation inputs. Current customer revision, seller and active style must be selected/revalidated when actual preparation eventually starts; Generation owns their exact snapshots. A queue item does not authorize a paid request.

## Admission and transactions

`admitReading(db, scope, unitId)` is an owner-authorized reusable application command. It locks the Store row, invokes `admitReadingInTransaction`, and commits. Internal transactional callers use their already authenticated member scope and existing Store lock. Intake operators may perform these existing intake/correction operations without obtaining paid-command permission. `buildGenerationContext` retains owner authorization by default for GenerationService; admission passes the internal membership-only option. The deterministic generation checks are shared unchanged; no second customer/product/style validator is introduced.

Admission requires the retained version to be published and usable, a matching latest CustomerInput revision, complete/usable required and supplied optional fields, confirmed per-quantity allocation, no unpaid/canceled/refund/non-digital/source-change/mapping-pause/other persisted holds, usable seller identity and active usable style. Only ASSISTED proceeds. Any existing Generation (successful, processing or failed) excludes a new automatic initial operation; retry/review belongs to its existing lifecycle. Expected configuration/hold failures return `ineligible`; tenant violations and unexpected DB failures propagate. Existing queue records return `already_queued` without mutation or repeated audit. This is idempotency lookup, not a claim that waiting work remains eligible forever.

Insertion and a single `reading_preparation_admitted` AuditLog row occur in the same transaction. Audit includes resource/actor/tenant only. No content is logged. Uniqueness is the final replay/concurrency defense; the Store lock serializes admission against intake, corrections, product/style/profile edits and manual generation. No process-local mutex, external network call or open transaction waiting on AI exists.

Automatic integration is mutation-driven, never a page GET:
- Receipt intake: after all purchased readings and issues are persisted, admit eligible readings before the receipt commits.
- Customer correction/allocation: admit after the new revision/issues and correction audit, in the same transaction.
- Profile save/style publication: reconcile missing eligible readings under the same Store lock.
- Mapping pause/resume changes: reconcile after issues are recalculated, in the same transaction.

A failed queue insertion rolls back the triggering transaction, avoiding committed eligible intake with lost admission. Replayed intake/corrections/reconciliation converge. Stale ignored receipts rely on already committed admission or explicit reconciliation.

## Reconciliation and tenancy

`reconcileProduction(db, scope)` is an explicit owner-scoped command, usable by future orchestration. It scans that Store's reading IDs and applies the same admission command per reading, returning scanned/queued counts. It only inserts missed eligible work; it never executes work or creates Generations. Internal `reconcileProductionInTransaction` supports setup/hold mutations that already hold the Store lock. Repeated scans create no extra rows or audit noise. No recurring schedule/HTTP admin endpoint/cron is added.

`readQueueItem` requires authorized membership and tenant-scoped lookup; cross-Store selectors and forged scope fail. Scope is derived by existing authentication/application boundaries, not browser Store assertions. Database ownership constraints and policy trigger reject forged associations even with known valid IDs. Future internal workers must establish authorized scope again before any paid action.

## Historical data and deferred behavior

Migration adds empty infrastructure only. Existing eligible ASSISTED readings are handled by explicit reconciliation after migration; no migration-time admission, execution history or historical style assignment occurs. Existing synthetic fixture seed/replay remains safe. Quantity and mixed carts remain Order → OrderLineItem → FulfillmentUnit; Love ×2 + Career ×1 creates three independent queue identities after each required allocation.

Part 1 intentionally retains QUEUED records if a later cancellation, pause, customer change or manual generation makes them ineligible. Nothing executes them. Later execution must recheck live holds, ownership, bound policy, customer revision and existing generation immediately before dispatch. Do not treat a durable admission as permission to produce. Successful manual preparation may coexist with its earlier waiting record; a later worker must resolve/skip that record without another paid call.

Deferred to Parts 2–4: execution lifecycle/schema migration, GenerationService invocation, stable generation command identity, worker authorization, claim/lease/fencing, scheduling/priority ordering/fairness, bounded concurrency, budgets/rate limits, retries/backoff and abandoned/ambiguous recovery. Reconciliation currently scans one Store without pagination; scaling/chunking is future orchestration work. Native multi-connection lock acceptance and rendered UI acceptance remain unverified in this restricted environment. Review Workspace, documents/PDF, delivery, Telegram, billing and style analysis remain out of scope.

## Exact Part 2 handoff

Use production/service.ts admission and reconciliation; production_queue rows are waiting intents with immutable recipe/urgency, not execution authorizations. Preserve one initial intent per reading and composite ownership. Add only the next explicitly authorized execution slice: first design lifecycle changes as an additive migration, coordinate manual preparation and prior waiting intents, derive a durable commandKey for GenerationService, and revalidate ownership/current eligibility. Keep GenerationService/gateway accounting and unknown-result protections. Style/seller/customer snapshots belong to Generation at actual preparation admission. Do not copy lease/retry behavior from Etsy sync or infer that those later parts were authorized here.


## PART 2 — SCHEDULING + CLAIMING

Implemented on the Part 1 base `8d6238972d40b871ea37d3cb4fbbae3517f62d2b`. This section supersedes Part 1's QUEUED-only and no-claim statements. No queue work executes in Part 2: no GenerationService/gateway/provider call, AIRequest or UsageEvent is created by scheduling. Manual generation stays available and authoritative.

### Lifecycle and additive migration

`0007_unknown_dreadnoughts.sql` preserves the existing table/rows/bindings and adds six nullable fields plus two indexes:

| Field | Meaning |
| --- | --- |
| claim_token | Random opaque UUID for the current claim, globally unique when present |
| claimed_at | Latest claim time; retained when an expired claim is skipped |
| claim_expires_at | Claim deadline; cleared on terminal resolution |
| scheduling_ordinal | Durable monotonic fairness turn, advanced on a claim or stale resolution |
| resolved_at, resolution_code | Terminal stale-work resolution time and bounded application reason |

Lifecycle: QUEUED → CLAIMED; QUEUED → SKIPPED; expired CLAIMED → new CLAIMED token or SKIPPED after revalidation. No COMPLETED or execution/retry state exists because no work executes. Queued metadata is initially null. Claimed metadata is complete with positive ordinal and expiration after claim time. Skipped records have no usable token/expiry, a resolution code/time and a fairness ordinal; prior claimedAt is retained if present. Null-sensitive CHECK constraints explicitly require fields rather than allowing SQL's unknown truth value to admit incomplete claims.

Existing reading/version/urgency uniqueness, ownership FKs and the Part 1 policy trigger remain intact. An additional handwritten transition trigger rejects terminal mutation, reset to QUEUED, claim token reuse and claim replacement before prior expiration, and retains claim-time history on resolution. Database checks/indexes reinforce the scheduler transaction protocol; they are not a substitute for running that protocol. Drizzle snapshots do not encode either trigger; preserve both in future migrations. No historical ProductVersion/Generation is changed and existing QUEUED rows remain QUEUED with null added fields.

### Exact deterministic scheduling order

Configuration is centralized in production/scheduling.ts. Defaults: claim batch 4, claim duration 120 seconds, aging threshold 120 minutes, urgent deadline window 15 minutes, inspection budget 100. `PRODUCTION_CLAIM_BATCH_SIZE` is the server environment override (validated integer 1..100); the trusted worker may pass a validated configuration. No per-call browser limit or concurrency control is exposed.

Within each Store compare ascending:
1. Priority band: aged waiting work (age ≥ 120 minutes), then near/overdue deadline (deadline ≤ now + 15 minutes), then EXPRESS, then STANDARD.
2. For the deadline band, earlier deadline first (most overdue first).
3. Earlier queue createdAt.
4. Lexicographically smaller queue UUID for stable ties.

A distant deadline does not bypass class/age. At the aging threshold even Standard/no-deadline work moves ahead of fresh urgent/Express work. Aged work is FIFO, so newer arrivals cannot perpetually overtake it. This deliberately trades some immediate urgency preference for progress on old waiting work. Claims/reclaims keep original queue age. Fairness assumes a finite older backlog and eventual progress; repeated expiration of the same unexecuted oldest work can delay siblings until later lifecycle/recovery parts resolve it. No throughput or completion-time SLA is promised.

Across Stores, use least-recently-served first: each Store's latest `max(scheduling_ordinal)` across its retained queue history, with no prior turn treated as zero. Ties use that Store's best candidate comparator above, then Store UUID. Give at most one claim per Store per cycle. Both claims and stale resolutions advance the global monotonic ordinal under the scheduler transaction lock. This keeps fairness durable across processes/restarts and works even when batch size is one or the clock does not advance. It also prevents a repeatedly stale Store from retaining an unserved zero-turn position forever. Fairness takes precedence over global deadline optimization; urgency orders a Store's work and breaks equal Store turns.

Candidate inspection is bounded too: at most inspectionLimit overall and at most `max(1, floor(inspectionLimit / candidateStoreCount))` per Store. A stale high-volume Store cannot consume the whole budget before others are checked. If more Stores than inspection slots exist, durable turns on processed work rotate remaining Stores into subsequent cycles. Finite continuously actionable Stores progress across cycles; endlessly arriving new Stores and an unbounded system backlog cannot have an absolute latency bound.

### Claim transaction and internal authority

`ProductionScheduler.forInternalWorker(serverDatabase, {configuration?, clock?})` creates the trusted in-process scheduler. `claimProductionWork()` accepts no seller/user/tenant/token payload. Possession of the server Database is the internal authority; there is no HTTP route, server action, remote worker authentication endpoint or browser export. The scheduler imports node:crypto and cannot be bundled as browser code. A deployment must run only trusted server code with DB credentials; this API does not sandbox arbitrary server code. Actual paid-operation worker authorization is deferred to Part 3.

Transaction:
1. Acquire the dedicated PostgreSQL advisory transaction lock (namespace key in scheduling.ts). This serializes short scheduling cycles across application processes; it is not a process-local mutex or an external-execution lock.
2. Read DB clock once (tests can inject a deterministic trusted clock), waiting/expired queue metadata and durable Store turns; calculate ordering/bounds.
3. For each selected Store, lock the owned persisted Store row before locking its selected queue row. This matches existing intake/manual generation/configuration lock order. Recheck queue state and expiration after acquiring locks.
4. Revalidate current domain eligibility. Resolve stale work or write CLAIMED/new token/times/ordinal atomically. Return the claimed metadata only after commit.

Each update is scoped by organization/store/item. Store ownership comes from retained queue FKs plus an actual owned Store lookup; no seller session is fabricated. Multiple workers return disjoint active work because cycles serialize in PostgreSQL and rows are durably claimed before the next cycle sees them. No transaction waits on generation or other external work. Batch and inspection bounds control work per cycle, not total outstanding claims or future model concurrency. Single advisory-lock serialization favors simple correctness over throughput; no SKIP LOCKED optimizer is needed for this pilot slice.

Queue metadata is scanned in memory; the DB scan itself is not paginated/bounded, although expensive eligibility inspections and returned claims are bounded. Query/index/pagination tuning is a future scaling concern. Unexpected DB/domain errors roll back the entire cycle rather than publishing partial claims.

### Revalidation, stale work and manual coordination

The existing generation context checks are shared without copying product/customer/style validators. `buildGenerationContext` retains its seller authorization wrapper (owner by default); the trusted `buildProductionContextForStoreInTransaction` reader operates on persisted organization/store identity under the Store lock, without inventing an actor. Seller/style reads use the same split authorized-wrapper/internal-reader pattern. Seller-facing scoped reads/mutations keep their membership/owner checks.

Any existing Generation (SUCCEEDED, PROCESSING or FAILED) resolves the waiting/expired claim as SKIPPED/EXISTING_GENERATION. Missing/malformed product, customer revision/required input/allocation, current operational holds, missing/unusable seller/style also resolve as SKIPPED using normalized admission codes. Valid customer corrections are read afresh, not rejected merely because they differ from queue admission; Generation snapshots belong to actual preparation later. No private context or source content is stored in claim metadata or returned by the scheduler.

Successful manual preparation after queue admission therefore prevents a later duplicate claim. Manual preparation can still begin after a Part 2 claim commits; Part 3 must recheck/coordinate before execution, and cannot treat the claim as permission to pay. SKIPPED is retained terminal history. Part 1 reconciliation returns existing intents and does not resurrect skipped work after a later hold correction; an explicit future resume/adoption policy is required. This part chooses durable terminal stale resolution as requested rather than silently requeuing held work.

Only meaningful stale resolution creates an AuditLog row (`reading_preparation_skipped`, null system actor, Store/resource metadata). Polls, ordinary claims and safe claim rotation create no seller audit noise. No personalization, style, prompts or generated bodies are logged.

### Expiration and Part 3 safety boundary

Expiration comparison is inclusive (`claimExpiresAt ≤ now`). An expired Part 2-only claim is revalidated under the same transaction/Store lock and may receive a fresh token/time/ordinal. An unexpired claim is never returned or rotated. Old tokens become obsolete; no execution/acknowledgment method is provided here. Retained fairness ordinals are scheduling metadata, not AI attempt numbers or provider retries.

Any Generation fences safe reclaim, including abandoned/ambiguous PROCESSING or FAILED work. The scheduler never resets generation/AI accounting or infers that a timeout means no request happened. Part 3 must bind queue intent to a stable generation command, enforce token fencing and paid-operation authorization immediately before dispatch, and integrate Generation Engine's durable accounting/unknown-outcome rules. It must distinguish queue claims that never dispatched from work that crossed the external boundary; claim expiry alone can never authorize another paid invocation.

### Exact PART 3 handoff

Preserve waiting policy bindings, per-reading uniqueness, Store lock order, claim token/expiration and scheduling turns. Add only the next expressly authorized execution layer. Design an additive execution transition that fences expired workers; coordinate already-started manual Generation; persist a stable queue-to-generation command relationship before external work; establish explicit trusted worker authorization for GenerationService while leaving seller security intact. Revalidate immediately before any accounted gateway request and run external work after commit. Resolve successful/manual work without paying twice; retain ambiguous AI outcome/accounting and prohibit blind redispatch after lease expiry. Do not infer provider retry/backoff, full abandoned execution recovery, documents, delivery or Part 4 authorization from Part 2.

## PART 3 — EXECUTION + SETTLEMENT

This section supersedes Part 2's execution deferral. Scheduling/admission remain unchanged. There is no recurring worker runtime, automatic retry, backoff, rate limiter or ambiguous-execution recovery.

### Trusted paid-worker boundary

`ProductionExecutor.forInternalWorker(serverDatabase, generationService)` accepts only persisted queue identity/current token at execution. Store, Reading and ProductVersion come from the queue's composite-owned row; callers cannot supply tenant identity. It is a trusted server-code API, not a route, server action, browser capability or remote authentication endpoint. Possession of server DB access is required. Arbitrary trusted code with database credentials is outside this isolation boundary.

The executor issues a frozen, process-local `ProductionAuthority` inside the fenced execution transaction; the capability is usable by the executor only after commit. GenerationService's dedicated `prepareProduction(authority)` accepts only objects issued by the server issuer (WeakSet membership); JSON/structural copies are rejected. WeakSet membership authenticates a capability; it is not a concurrency lock. Database state/token/ownership/expiry checks remain authoritative. Normal seller `prepare(scope, command)` retains owner authorization. No user or seller session is fabricated. CentralAIGateway admits the same authority while retaining all existing budgets/provider policy/accounting. Neither execution nor settlement imports/calls the gateway/provider.

### Durable lifecycle and command binding

| State | Meaning | Automatic reclaim |
| --- | --- | --- |
| QUEUED | Waiting intent | Scheduler may claim |
| CLAIMED | Token-owned, not executing | Safe expired pre-execution reclaim only |
| SKIPPED | Deterministically stale before execution | Never |
| EXECUTING | Durable paid-execution intent; dispatch may or may not have happened | Never |
| COMPLETED | Referenced canonical Generation succeeded | Never |
| ATTENTION | Known failure, blocked admission after intent, or uncertain outcome | Never |

Additive migration 0008 adds `generation_command_key`, `generation_id`, `execution_started_at`. The queue UUID is the Generation command UUID. It is committed with EXECUTING before GenerationService admission/provider dispatch. Same durable intent always retains the same command across processes/restarts. GenerationService inserts its Generation, associates the queue reference, admits AIRequest and provisional UsageEvent in one transaction; the engine's command hash/idempotency is unchanged. The queue contains references/status only, never canonical bodies or private context.

Database checks require exact command identity, coherent lifecycle metadata, same-tenant Generation ownership and immutable retained production policy. Transition triggers protect current token, claim history, one-time Generation binding to the same Reading/ProductVersion, successful Generation for COMPLETED, and immutable terminal rows. Existing waiting/claimed/skipped rows retain their fields with null execution bindings; no migration-time execution is invented.

### Final fence and manual race

Execution validates UUIDs, derives Store from the persisted row, locks Store before queue, then checks current CLAIMED state/token and nonexpired DB-clock lease. It reuses the existing production context builder and exact bound ProductVersion/ASSISTED policy, and rejects any existing Generation or current hold/input/profile/style/configuration problem. Deterministic stale rows become SKIPPED without any Generation/AIRequest/UsageEvent. Product/style/customer text is never accepted as worker instructions.

After the fence commits, GenerationService uses the same Store lock as manual preparation, checks all admission rules again, snapshots current usable style/customer/seller against retained ProductVersion, and excludes existing/conflicting Generation. A manual preparation that wins before the fence produces SKIPPED. If manual preparation wins the short fence→engine admission gap, the engine rejects the worker without another call; queue becomes ATTENTION/PREPARATION_BLOCKED. Conversely, an admitted worker's PROCESSING Generation blocks a competing manual command. Final gateway preflight rechecks customer revision/eligibility and worker claim authority before dispatch. Changes after the committed dispatch decision cannot retract an already authorized external request.

### Transactions, tokens and crash windows

1. Short transaction: Store→queue lock, final domain fence, persist EXECUTING/stable command/start time, issue server capability; commit.
2. Existing GenerationService staged transactions and provider invocation. No executor transaction is held during external work. Queue/Generation association and provisional accounting commit before dispatch.
3. Short transaction: Store→queue lock; compare current token; inspect persisted Generation/AIRequest; settle outcome. No result supplied by a worker is trusted as canonical truth.

Wrong/expired/replaced CLAIMED tokens cannot dispatch. Old acknowledgements cannot mutate a newer claim or terminal history. EXECUTING is never rotated or reclaimed, even when its former claim deadline passes; expiry cannot prove the absence of external work. Actual dispatch admission still requires a nonexpired token. Settlement after dispatch may succeed after expiry because the current nonreplaceable token still owns its incurred operation. Terminal rows retain the opaque token for fenced replay; expiry is cleared. Tokens are never seller-visible.

A crash before EXECUTING permits safe Part 2 reclaim. A crash after EXECUTING but before Generation admission leaves a conservative nonreclaimable intent. A crash after accounting admission/dispatch can leave PROCESSING Generation and CLAIMED/RUNNING AIRequest with unknown cost. Replaying EXECUTING only inspects records, returns IN_PROGRESS when unfinished and NEVER re-enters GenerationService. A crash after canonical success but before queue settlement can be acknowledged from persisted success without provider redispatch. No automatic abandoned-execution resolution exists in this part.

### Settlement and accounting

Persisted SUCCEEDED Generation → COMPLETED/SUCCEEDED, retain Generation reference, clear expiry. FAILED Generation → ATTENTION/GENERATION_FAILED or OUTCOME_UNCERTAIN when the AIRequest is ambiguous. An unexpected execution interruption with an admitted request → ATTENTION/OUTCOME_UNCERTAIN while retaining incomplete Generation/accounting. Rejection/interruption after execution intent with no associated request → ATTENTION/PREPARATION_BLOCKED; the engine’s accounting-before-dispatch invariant proves no provider invocation occurred. No failure triggers a new command or scheduler retry.

`acknowledge(queueId, token)` can settle already persisted terminal engine outcomes only; unfinished records return IN_PROGRESS. Token mismatch returns STALE_CLAIM without mutations. Terminal replay returns stored outcome without paid work. Unknown costs remain null/unknown; no queue accounting path exists. Provider failures with usage retain CentralAIGateway's exact integer USD nanos and pricing snapshot. Successful return-path interruptions can still settle success from canonical state.

Meaningful skip/completion/attention events use existing audit rows with null system actor and Store/resource metadata. No poll audit noise, prompts, customer/style text, bodies, secrets or raw errors are logged.

### Cycle and seller projection

`runProductionCycle(scheduler, executor)` obtains Part 2 bounded claims and executes them sequentially after claim commit. `productionRuntime(db).runCycle()` wires existing centrally configured GenerationService for explicit server invocation. No command is exposed to the browser; invoking this runtime can incur real provider cost according to existing environment configuration. No cron/daemon/recurrence is installed.

Claim batch is the maximum considered per cycle; the existing one-claim-per-Store fairness rule remains. Execution is sequential, not a global distributed concurrency guarantee. Later claims can expire while earlier work runs: they return STALE_CLAIM without dispatch and remain safely reclaimable. Multiple trusted cycles can run concurrently across different intents; a future rate/concurrency policy must address total outstanding provider calls.

Seller projection uses scoped queue metadata: QUEUED/CLAIMED → Waiting, EXECUTING or PROCESSING Generation → Preparing, canonical success → Ready for review, ATTENTION → Problem. Existing operational holds and revised-customer successful-content warnings remain authoritative. Canonical success takes precedence over queue metadata. Existing minimal generated-section inspection/manual Prepare flow remain; no Review Workspace or redesign.

### Exact PART 4 handoff

Keep the stable queue UUID→command binding and same-Reading/ProductVersion reference. Never rotate/reclaim EXECUTING or infer retry safety from expiration. Part 4 must define explicit known-failure retry/resume/adoption rules and durable command identities for any new paid attempt; do not silently reuse an ATTENTION command as a fresh invocation. Preserve every AIRequest/UsageEvent and unknown-cost liability. Investigate abandoned EXECUTING/PROCESSING/RUNNING work conservatively before any operator-approved recovery. Retain token-fenced acknowledgement, Store-first locking, bounded claims and shared engine admission. Decide runtime/deployment, global concurrency/rate controls and reconciliation independently; none is provided here. SKIPPED and ATTENTION history remains terminal until an explicit future policy/migration is designed. PDF/delivery/Telegram/billing/review remain outside this slice.

## PART 4 — RECOVERY + RETRY + RUNTIME

Production Orchestration Parts 1–4 are complete within the bounded scope. This section supersedes earlier retry/recovery deferrals. No deployment daemon, provider status polling/webhook, full distributed rate limiter, review/document/delivery/style-analysis work is included.

### Recovery classification and conservative policy

| Classification | Durable evidence | Action |
| --- | --- | --- |
| PRE_DISPATCH_SAFE | No admitted request, or CLAIMED request with null startedAt, or known preflight rejection | Resume only with compatible eligibility; never assume expired lease alone proves safety |
| KNOWN_RETRYABLE | FAILED Generation + FAILED, nonambiguous RATE_LIMIT request + matching ledger | Persist explicit linked retry and backoff |
| KNOWN_NON_RETRYABLE | Known AUTH/BLOCKED/INVALID_OUTPUT/other provider failure | ATTENTION; automatic policy does not repair configuration or output |
| AMBIGUOUS | TIMEOUT/NETWORK regardless of supplied flag, ambiguous request, or unresolved RUNNING request | ATTENTION/OUTCOME_UNCERTAIN; no automatic or ordinary seller retry |
| ALREADY_COMPLETED | Valid canonical SUCCEEDED Generation + SUCCEEDED request + matching ledger | Adopt success with zero provider calls |
| IN_PROGRESS | Current unexpired execution or unfinished passive acknowledgement | Leave running; do not redispatch |
| INCONSISTENT | Missing/mismatched ownership, canonical result, command lineage or accounting | Fail closed to ATTENTION/INCONSISTENT_STATE |

`recovery-policy.ts` owns provider-neutral policy. There is no Gemini string parsing in orchestration. CentralAIGateway forces post-dispatch TIMEOUT/NETWORK ambiguity even if a provider supplied an unsafe false flag; Gemini already marks these ambiguous. HTTP 5xx remain conservative ambiguous failures under the existing adapter. No provider retry loop or prompt/model/pricing change was introduced.

Unknown cost and unknown external outcome are separate: a durable known nonambiguous rate-limit failure may have unavailable usage/cost. Its null amount and reserved liability remain preserved even when a safe new attempt is permitted. Gateway budgets still include that liability.

### Attempt identities, maximum and durable backoff

The existing engine maximum is one central `MAX_GENERATION_ATTEMPTS = 3` (initial plus at most two retries). Queue schema and policy use that same maximum. Engine ordinals include admitted zero-cost preflight failures, consistent with its existing retry model. Production does not maintain a second paid-attempt counter or a second Generation history.

Queue's initial `generationCommandKey` remains its UUID forever. `executionAttempt`, nullable `retryCommandKey` and `availableAt` are the only added per-queue retry fields. A real retry's UUID is deterministically derived from a versioned SHA-256 namespace, queue UUID and next **engine** attempt ordinal; it is persisted before claim/dispatch. Initial command and original executionStartedAt remain immutable. Every admitted retry uses existing GenerationService's retryGenerationId, original Generation/context, parentRequestId and next ordinal; AIRequest retains every paid command and UsageEvent remains one ledger record per attempt. IDs do not imply provider-side idempotency.

Known retryable failure → RETRY_WAIT, first delay 30 seconds, second delay 120 seconds. Delay starts when retry scheduling is durably committed. Restart/reconciliation of an existing valid waiting retry does not reset its timer or identity. No retry runs inside the provider exception handler; the already claimed cycle does not claim newly scheduled retries. Reaching attempt 3 failure gives ATTENTION/MAX_ATTEMPTS. Budget rejection is held as ATTENTION/BUDGET_LIMIT instead of repeatedly rescheduling the earlier rate-limit error; explicit owner recovery is required after configuration/budget remedy.

A crash before admission created no AIRequest: safe compatible recovery retains the SAME initial command/ordinal. An admitted but definitely undispatched CLAIMED request resumes the SAME request/command/accounting intent (not a new paid retry). GenerationService permits this only on the internal capability path with null startedAt and no ambiguity. Gateway atomically changes CLAIMED→RUNNING before dispatch, rechecking worker authority after acquiring the Store lock. Normal seller command replay remains unchanged. A durable FAILED preflight request requires a **new** linked retry command, preserving its known-zero history.

### Lifecycle, schema and history

RETRY_WAIT joins the existing queue lifecycle. It retains prior token/history/reference and has a nonnull durable availableAt; a due scheduler claim rotates token, clears waiting resolution/availability and retains initial command/Generation bindings. Retry claim/dispatch uses the same scheduling/fairness, Store-first locking and final eligibility fence. New claims cannot run before availableAt. SKIPPED/COMPLETED remain immutable; ATTENTION can be reclassified by validated recovery or explicit safe retry, and late proven canonical success can become COMPLETED. Stale-token acknowledgements cannot overwrite newer attempts.

Additive migration 0009 preserves existing rows with executionAttempt=1 and null new fields. It adds retry/recovery indexes, retry command uniqueness, coherent null-sensitive lifecycle constraints and guarded transition expansion. Database retry transitions require a provably undispatched request or a known nonambiguous permitted failure; RUNNING, timeout/network and ambiguous requests cannot become runnable through this transition. Existing Generation/AIRequest/UsageEvent records are not rewritten to fabricate success/failure or cost.

Meaningful retry scheduling/completion/attention changes are audited without private data. Owner retry records the real actor; internal operations have a null system actor. Repeated scans/unchanged retry waits generate no audit noise. Initial and subsequent admitted execution histories remain in the queue, AIRequest/UsageEvent and audit actions rather than a redundant retry-attempt table.

### Bounded reconciliation and abandoned work

`ProductionRecovery.forInternalWorker(db, {limit?, clock?}).reconcileProductionWork()` is an explicit trusted server boundary. Default limit 50, validated range 1..1000. Indexed SQL selects only bounded expired EXECUTING, ATTENTION and due RETRY_WAIT work, ordered by updatedAt then UUID. Each transaction derives owned identity from persisted queue, locks Store→queue, rechecks current state and inspects exact Generation/request/ledger/canonical data. Unchanged attention checks advance metadata scan age without creating audit noise, so bounded scans rotate through older attention rows. Scheduler's older all-history metadata scan remains a separate scaling limitation.

- Expired CLAIMED with no execution remains Part 2 safe reclaim; it is not an AI retry.
- Expired EXECUTING with valid local canonical success adopts COMPLETED without provider calls.
- Durable known failure schedules only an eligible bounded retry or attention.
- Definitely undispatched compatible work can resume its persisted identity.
- RUNNING/ambiguous/unknown or inconsistent work is quarantined without dispatch, deletion or fabricated accounting. RUNNING/PROCESSING remain historically unfinished; queue records attention. If the original authorized worker later durably supplies authentic success, acknowledgement/reconciliation can adopt it without a second call.
- Changed customer revision blocks retry under old context; bound ProductVersion stays exact. Retry keeps original seller/style snapshots under existing engine rules, while requiring usable current profile/style and current holds to permit admission. Product edits never rebind historical readings.
- Safe abandoned work that has become ineligible is held/skipped, not recreated under a new customer request. Undispatched incompatible accounting intent may remain conservative until explicit later resolution; no guessed zero-cost cleanup or regeneration is performed.

`requestProductionRetry(db, sellerScope, readingId)` provides owner-authorized domain recovery for policy-permitted safe attention work. It verifies the normal seller scope, looks up only the owned Reading's queue, locks Store→queue, rechecks safety/context/max and schedules durable backoff. Replay of an existing waiting retry converges. Cross-tenant or ambiguous/nonpermitted work is rejected. No browser action, trusted-worker route or large retry UI is added. Existing Manual preparation remains independent; waiting retries suppress misleading manual retry prompts. Problem/ambiguous work uses support-oriented copy.

### Bounded runtime, overlap and deployment boundary

`productionRuntime(db).runProductionTick()` obtains one DB-backed tick owner, reconciles bounded work, claims a bounded cycle and executes sequentially. It returns compact metrics/outcomes. It never needs a page visit. Existing runCycle remains a low-level trusted compatibility API; external recurring deployment should invoke runProductionTick, not bypass its coordination.

The three-column `production_tick` singleton is coordination metadata only: token + expiry, no customer/tenant content. Short advisory/row-lock transactions acquire an owner or return BUSY. Lease is 15 minutes, renewed before claims and each execution. Token-fenced release cannot clear a newer owner; a superseded/expired tick stops before further dispatch. No transaction is held across provider execution. Crash/stale tick expiry permits a new **reconciliation tick**, never authorizes a second ambiguous paid request. Queue/request state and engine fences remain the paid-operation authority.

This prevents ordinary overlapping ticks from multiplying retry/execution calls. It is not full provider-wide distributed rate limiting: seller manual execution and trusted low-level cycles are separate, and an exceptionally delayed external request may outlive tick ownership. Such work remains quarantined, not redispatched; late authentic results remain accountable. Existing Gemini transport bounds requests to 120 seconds. Total provider concurrency/rate policy, process monitoring and native multi-process acceptance remain Production Hardening.

A real deployment must install an external recurring trigger for this bounded callable operation. Platform selection, cron binding, infinite loops and setInterval workers are deliberately absent.

### MRH reference inspection

Available read-only reference: `/Users/yusufsafakilic/Codex/medium-reading-platform`, checkout HEAD `9d58e2cb308f6ea552527fa74a6bba99bde2f37b`. Findings describe inspected source, not a live MRH incident reconstruction.

- `src/llm/gemini/gemini-llm.provider.ts`: Fetch/AbortController with configurable default 60-second timeout, memory delays 1/2 seconds and at most three calls per complete(). Network/timeout exceptions map to retryable UNAVAILABLE; 429 and 5xx may be retried inside the provider. A timeout does not distinguish whether Gemini received/executed the request. This is not a reliable lost-response solution and is NOT copied.
- `src/readings/application/create-reading.service.ts`: persists PROCESSING before generation and catches failures into FAILED; persists successful content before later report handling. Saving canonical content before downstream work is a sound idea already implemented in Reading OS.
- `src/readings/application/reading-retry.service.ts`: CAS updateMany FAILED→PROCESSING, increments retryCount/lastRetriedAt, retains previous failure and reuses Reading identity/context; then invokes orchestrator again. This provides concurrent operator retry exclusion, not proof that a timed-out provider did not complete. Inspected code does not persist an immutable separate provider-attempt/command identity or ambiguity/usage liability for each hidden provider retry.
- `prisma/schema.prisma` Reading model has retryCount/time/failure/result, not Reading OS's AIRequest/UsageEvent architecture. Relevant provider/readings code exposed no completion webhook/status-query or lost-response reconciliation primitive. No claim is made about uninspected unrelated MRH systems or current Google API capabilities.
- FulfillmentRetryPolicyService has durable-oriented delay/batch concepts for fulfillment; delivery/PDF architecture is outside this inspection and was not copied.

Regression tests explicitly reproduce timeout after dispatch, upstream false ambiguity flags, lost response/accounting settlement and restart: exactly one fake provider call, retained request/ledger, null unknown liability and attention—not automatic retry.

### Remaining gates and next bounded work — document only

Production Orchestration is complete for this milestone, not a production launch certification. Native PostgreSQL acceptance is blocked by shared-memory permissions. No real Gemini/Etsy/customer data call or deployment was executed. Native multi-process contention, deployment/recurring trigger, global rate/concurrency controls, operator diagnostics, reservation/cost reconciliation, pagination, retention and live-intake gates remain separate Production Hardening.

1. **Controlled real Gemini acceptance:** a later separately authorized task may make ONE synthetic generation using locally configured GEMINI_API_KEY to verify request/structured output/canonical validation/usage/AIRequest/UsageEvent/cost compatibility. Never paste keys into prompts/repo/docs. Zero such calls occur in Part 4. This is the recommended next bounded acceptance task; Review Workspace can follow under its own authorization.
2. **Style Intelligence / Previous Work Analysis:** stored StyleSources remain unanalyzed. Later controlled historical-reading analysis should produce compact versioned voice/tone/structure/tendencies/preferred/avoided phrases/detail/opening/closing attributes and possibly a small bounded exemplar set. Never inject the whole library. Every later analysis call must use CentralAIGateway/accounting. Not implemented here.
3. **Etsy delivery capability reverification:** when Delivery begins, recheck current official Etsy documentation for order PDF upload, buyer-conversation attachments and dynamic post-purchase delivery. Do not invent endpoints. If unsupported, design a truthful manual-delivery workflow. No delivery/chat operation is implemented here.
4. Review Workspace, approval/editing, PDF/documents, delivery, Telegram and billing remain separate future milestones. None begins automatically after Part 4.
