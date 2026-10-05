# Cost and usage model

Status: architectural requirements, 2026-10-05. Provider, pricing, allowance values, billing currency and customer charging policy are undecided. No current model prices are assumed.

Milestone 1 makes zero model calls and includes no AI SDK, provider credentials, model operations, generations or usage tables. Intake/mapping/validation are deterministic. The requirements below apply when billable capabilities are explicitly introduced later, not as permission to add those tables now.

## Governing rule

Every billable external model operation must be observable and attributable. This includes content production, product tests, explicit regenerations, repair calls, safety/model checks if billable, fallback requests, and failed/retried requests. No UI, background job, integration adapter or helper may invoke a model provider outside the controlled gateway.

External calls have cost even if the application receives no usable output. A timeout or missing usage report is not evidence of zero cost. Internal production cost is distinct from a seller subscription/credit charge; do not build customer invoices by summing estimates.

## Deterministic work first

Use ordinary code for Etsy JSON parsing, identity/SKU/variant mapping, order counting, quantity expansion, field validation, dates/amounts, state transitions, template composition, document rendering, approval and delivery eligibility. These operations should not generate model requests.

Recipe-specific deterministic selection/calculation can be introduced as a typed capability: for example, record a selected spread and algorithm/version rather than asking a model to invent a random card draw. Choose the actual product semantics before implementation. Do not force this capability onto letters or other categories.

Model work is justified only when the product requires language/content synthesis or another evaluated probabilistic capability. An additional validation/repair call is another costed operation, not a hidden helper. Prefer schema validation and a surfaced failure to unlimited paid self-correction loops.

## Gateway contract

The application submits a logical operation with tenant/store attribution, unit or product-test context, generation ID, operation type, immutable input/configuration hashes, selected provider policy, output schema/version, bounded request limits, and an idempotency key. The gateway enforces provider capabilities, budgets, concurrency, timeouts and retry policy, then records every physical attempt.

One operation may have several attempts; every actual billable request is an attempt, including SDK/network retries. Disable implicit SDK retries unless their accounting is explicitly integrated. Explicit regeneration is a new generation/operation, not a replay of the old command. Changing provider/model requires policy/configuration revision, not rewriting order business logic.

## Required attribution and observability

| Field group | Required semantics |
| --- | --- |
| Ownership | Organization and store; tenant consistency checked against referenced records |
| Business context | Order, line item, fulfillment unit, generation where applicable; product/revision and test-run ID for tests |
| Exceptions to order attribution | Test operations have explicit null order/unit with purpose=test; future non-order operations need an explicit attributable purpose, never invented orders |
| Identity | Logical operation ID/key, attempt ID/ordinal, triggering command/job and actor, trace/correlation ID |
| Provider | Provider, requested/resolved model/version where available, operation type, provider request ID, execution mode and region if relevant |
| Lifecycle | Intent/reservation time, dispatched/start/end time, latency, retry reason, outcome, error classification, unknown-outcome state |
| Input provenance | Hash and references for recipe, reader, templates, platform rules, context, request schema and bounded request settings |
| Usage | Input/output tokens where supported, cached/reasoning/media units where exposed, usage-source/completeness; absent differs from zero |
| Cost | Currency, estimate/reservation, actual/calculated cost, pricing revision, uncertainty state and reconciliation reference |

Do not log raw customer prompts/outputs by default for usage accounting. Store protected references and hashes; any diagnostic content retention needs an explicit privacy policy and access controls. A provider ID is not guaranteed to arrive on failure; keep the local attempt ID regardless.

## Durable execution and duplicate prevention

1. Validate unit eligibility and tenant scope. Atomically admit one logical command for the expected unit/revision, reserve its bounded maximum estimated cost, and persist durable work.
2. Compose bounded requests deterministically from pinned inputs. Select an allowed provider/model/pricing policy; fail closed or use an approved conservative bound if pricing is unknown.
3. Persist the attempt intent before dispatch. Include a provider idempotency key only when the provider documents support; application keys alone do not deduplicate the provider.
4. Dispatch outside the database transaction. Record provider ID, output, usage and outcome durably. Only validated, complete content becomes accepted generation content.
5. Reconcile reservation to measured/estimated usage. Track uncertain liability for requests that may have run but lack an outcome. Retain successful output across PDF/delivery failures.

A crash between dispatch and outcome recording creates uncertainty. A lease timeout must not trigger another billable request automatically. Query/recover provider results if supported; otherwise hold and surface an issue. A seller may explicitly authorize a new attempt after seeing the possible additional cost, within normal configured limits. Retain both attempts and their uncertain accounting. This is bounded at-least-once external execution risk, not an exactly-once guarantee.

Differentiate accidental duplicate work from deliberate generation: repeated same command returns its existing result; a new regeneration command requires a distinct intent, visible estimated cost and per-unit active-work guard. Do not globally cache outputs by prompt hash across tenants or customers. Reusing retained accepted content to rerender within the same authorized context is safe and avoids new model spend.

## Retry policy

Classify provider errors: known pre-execution rejection, retryable transient failure with known outcome, invalid content, terminal configuration/auth failure, ambiguous timeout/network/crash. Use operation-level total attempt and total cost limits, backoff/jitter, deadline, and a circuit breaker/provider pause as needed. Numerical values must be configured and agreed before live production.

Every repair/fallback attempt consumes the same generation budget or an explicitly authorized additional budget. A fallback provider may have different pricing/privacy semantics and is not enabled automatically in V1. Prevent retries at several layers multiplying attempts: one gateway policy owns retries; queues resume the logical operation and inspect durable state.

## Pricing and calculation

Maintain effective-dated PricingRevisions keyed by provider/model/operation/unit/currency and execution mode as relevant. Prices are data behind a pricing policy, not conditionals scattered through fulfillment code. Persist the revision and calculation basis with estimates and measured charges. Changing the current schedule does not rewrite historical records.

Illustrative formula (not a price quotation): token_cost = input_tokens * input_rate_per_million / 1,000,000 + output_tokens * output_rate_per_million / 1,000,000. Add supported cached, reasoning, media, fixed-request, tool or other billable units using that provider's actual pricing rules; avoid double-counting units already included in totals. Use fixed-precision decimal/integer money arithmetic, explicit currency and rounding, never binary floating-point financial totals.

Distinguish: reserved upper bound, preflight estimate, usage-based calculated cost, provider-reconciled actual charge, and unknown/incomplete cost. Cached tokens are not assumed free. Zero is valid only when known. Exchange conversions, if introduced, keep original currency plus the conversion source/date/rate.

## Budgets and controls

Enforce caps at organization/store and generation levels before dispatch, including concurrent reservations. Product policies bound input sizes, examples, sections, output tokens, total attempts, test frequency and concurrency. Global provider limits protect the platform from runaway tenants. Tests, retries and explicit regenerations consume allowance too.

Reservations must be atomic: two jobs cannot both spend the last remaining allowance. Release only known unused reservations. Retain a conservative liability for uncertain attempts until reconciled; a crash-cleanup process must not release it and immediately permit another identical paid request. Budget exhaustion creates a hold with a seller remedy, not silent truncation or an unannounced cheaper-model switch.

Do not perform speculative pre-generation, unbounded per-section parallel calls, or extra model calls for cosmetic differences. Prefer one bounded content operation initially; document rendering and delivery have their own infrastructure costs but no content regeneration charge.

## Reporting and reconciliation

Aggregate usage by organization, store, order, unit, generation, product, operation, provider/model and time window. Include failed attempts and uncertain liabilities. Cost per delivered unit includes test/retry overhead when reporting product economics; make the allocation rule explicit rather than silently dividing order cost by line count.

Track cost of content separately from rendering, storage, email/delivery and other infrastructure where material. A complete SaaS margin model also includes support, refunds and subscription/payment costs; detailed commercial forecasting can wait. Usage lineage cannot wait.

Reconcile provider totals/invoices or usage APIs when available without rewriting ledger history: append adjustments with reason and source. Alert on orphaned attempts, missing attribution, unexpectedly high token use, repeated repair calls, duplicate intents, unknown pricing, unexplained spend and stuck reservations.

## Release acceptance

- A repeated event/click produces one logical generation request; intentional regeneration is separately visible.
- A timeout leaves a durable uncertain attempt and cost liability, not a zero-cost success/failure fiction.
- PDF retries make no model calls; successful content is retained.
- Tests are attributable to tenant/store/product/revision without fake fulfillment units.
- Concurrent budget admission cannot overspend the configured bound.
- Every physical attempt has provider/model/operation/retry metadata and usage completeness; missing provider metrics are explicitly unknown.
- Updating pricing changes future policy without changing business logic or historical cost basis.
- A second tenant cannot read another tenant's usage, protected prompts or content references.
