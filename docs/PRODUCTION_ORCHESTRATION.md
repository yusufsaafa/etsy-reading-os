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
