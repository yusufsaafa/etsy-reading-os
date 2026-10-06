# Generation engine and central AI gateway

Implemented 2026-10-05 on `codex/ui-ux-design-lock`, based on `d10e6fe0f98c8e7381e9f2528a1bb4358bc3f77b`. This is canonical content preparation only. Queue, document rendering, delivery, Telegram, billing, style analysis and multi-reader support remain outside this milestone.

## Inspection and domain decisions

The base has 21 tables, additive migrations 0000–0004, immutable published ProductVersions and StyleProfileVersions, mutable single-store SellerProfile, append-only service-level CustomerInput revisions, exact per-reading product bindings and Store-row locking for intake/configuration/correction. Operational readiness is derived from existing issues. Seller/style has a repeatable-read production context boundary. AuditLog carries metadata only. PrivateObjectStorage has a port only. BackgroundJobs currently implements Etsy synchronization, not production. There were no existing generation/AI/accounting implementation tables, provider SDKs or configured model.

Reuse those boundaries: no second mapping/input validation model, no new storage implementation, no new job implementation. Generation admission reuses sellerProductionContext through a transaction-compatible reader rather than a nested transaction. Intake remains Order → OrderLineItem → FulfillmentUnit, with no receipt-level generation. StyleSource bodies and metadata are not included in model instructions.

## Command and context

`GenerationService.prepare(scope, { unitId, commandKey, retryGenerationId? })` is an application command independent of React/HTTP. The browser submits resource and command IDs only; the authenticated server derives scope. Owner permission is required for paid commands; authorized members can read retained work/accounting. Future workers can call the same command using an authorized actor scope.

Admission holds the existing Store row lock and verifies membership, owned reading, versioned bound product, published configuration validity, latest matching customer revision, required/optional field validity, quantity allocation, payment/cancellation/refund/digital/source-change/pause holds, saved seller identity and usable active published style. Any hold fails before dispatch. Intake issues remain authoritative operational holds; admission also recalculates them deterministically instead of trusting an old Ready badge.

GenerationContext v1 contains:
- Reading, line and order IDs for attribution.
- Exact bound ProductVersion ID, version number and generic input/ordered section/output/workflow configuration.
- Exact active StyleProfileVersion ID, version number and structured style at admission.
- SellerProfile reference plus bounded displayName and optional shortBio snapshot.
- Exact CustomerInput revision and supplied answer snapshot.

No buyer email, credentials, source documents or unnecessary seller fields are copied. Product/style are immutable version references; the context is also frozen in JSONB with SHA-256 stable-JSON hash. Mutable seller edits cannot reconstruct/change an older generation. Every retry of that generation uses the original context, not the newly current style/seller. Changed customer revision prevents retry; this slice offers no regeneration/replacement workflow. Initial generation after a new product activation still uses the reading's original bound version, including an archived published version.

## Tables and lifecycle

Migration `0005_green_mindworm.sql` adds three tables and no historical data assignments:

| Table | Meaning |
| --- | --- |
| generations | Store/reading ownership, exact product/style/seller/customer bindings, frozen context/hash, PROCESSING/SUCCEEDED/FAILED, canonical successful result, timestamps |
| ai_requests | Each physical attempt, generation where applicable, ordinal, command key/hash, parent request, operation, provider/requested and resolved model, request correlation, status/failure/ambiguity, tokens, duration, frozen pricing/reservation/estimated and optional actual cost |
| usage_events | One accounting record per AIRequest; operation, USD nanos or null, cost completeness; generation/order/reading attribution is derived through the request and GenerationContext |

AIRequest is the GenerationAttempt equivalent; a redundant attempts table is unnecessary. Nullable generation supports a later explicit non-order operation without fabricated orders. Only PERSONALIZED_CONTENT_GENERATION is actually implemented. Operation is bounded by the server command, not client text; future classifications can extend application types without a database enum migration.

AIRequest: CLAIMED → RUNNING → SUCCEEDED/FAILED. Provisional unknown accounting is committed before invocation. A known deterministic recheck failure becomes FAILED/known_zero before invocation. Terminal attempt metadata and known accounting are protected against rewriting. Triggers check accounting correspondence at commit and verify retry parent/ordinal lineage. Composite foreign keys enforce same organization/store references. A Generation has one active request and a reading has one processing Generation.

Seller projections: existing holds take precedence; otherwise Ready → Preparing → Ready for review, or Problem. A newer customer revision projects Review updated information while retaining older content. New/Ready counts exclude already prepared/processing readings. Existing attention lists expose preparation/review problems using the same components. There is no approval, completed document or delivery transition.

Future lifecycle: READY → QUEUED (future) → PROCESSING → READY_FOR_REVIEW → APPROVED (future) → DOCUMENT (future) → DELIVERY (future). No QUEUED state, production queue, worker polling or scheduling is added here.

## Provider boundary and canonical result

Only CentralAIGateway invokes GenerationProvider. Application/domain features never import a provider SDK or call its generation method. The provider-neutral contract uses request strings, bounded output limit, configured section identities and normalized response/usage/failure values. It contains no vendor response types.

The Gemini adapter uses the documented REST generateContent API with one fetch, server-side x-goog-api-key, separate systemInstruction/user contents, structured JSON response schema, one candidate and 8,192 maximum output tokens. It requests no tools, grounding, files, embeddings or explicit cache creation. Redirects are rejected, timeout is 120 seconds, oversized responses fail, raw error bodies are never propagated, and there are no implicit SDK/HTTP retries. Native fetch was chosen over an SDK to avoid a new dependency and hidden retry machinery; no package/lockfile/license changes.

The centrally configured initial live model is gemini-3.8-flash. Official model documentation checked on 2026-10-05 lists stable availability and structured outputs; older 2.5 documentation now restricts new-project availability. No model names appear in generation domain services. The requested model and provider-returned modelVersion are retained separately, with responseId where available. Model aliases can change; the recorded resolved version is evidence, not a promise of deterministic model replay.

Canonical v1:
```json
{"sections":[{"sectionId":"configured-stable-id","title":"Configured title","content":"Nonempty personalized prose"}]}
```

Every configured section is required in this ProductVersion format. Zod rejects extra fields, malformed JSON, invalid types, excessive/empty content, duplicate IDs, missing/unknown IDs and title mismatches. Output is reordered to the retained product sequence. Invalid content never becomes a successful Generation. Usage from such responses is still accounted. No model repair call occurs automatically. There is one canonical result, never separate text/PDF content.

## Instruction boundary and privacy

One testable instruction assembler creates fixed platform rules plus one JSON data envelope containing seller identity, structured style, configured product sections, customer answers and output requirements. Platform instructions have the highest role; seller/product/customer strings never become system instructions. Prompt injection remains a probabilistic residual risk: delimiters and instructions do not prove perfect prevention. No tools or privileged decisions are delegated to model text. Model output cannot select tenants, approve work or deliver anything.

Normal logs and AuditLog contain no prompt, personalization, style instructions, previous work or canonical body. AIRequest/UsageEvent contain accounting metadata, not prompts. GenerationContext/content are private domain records behind scoped authorized services and escaped React rendering. Generation/attempt/accounting history cannot be removed via this slice; an explicit retention/deletion/reconciliation process is still a production launch gate. Live use requires approved provider privacy and paid-tier data-handling configuration; the app cannot infer the account's billing tier from a key.

Audits: generation_requested, generation_retry_requested, generation_succeeded, generation_failed; resource/actor/store only. Dispatch settlement does not require the actor still to be a member: already incurred cost must be recorded after authorization revocation. Reads/new commands always reauthorize.

## Pricing and money

Money is PostgreSQL bigint in integer USD nanos: $1 = 1,000,000,000 nanos. Application calculations use BigInt, never float money. AIRequest preserves the pricing snapshot, reservation, result and estimate completeness so future price changes cannot recompute history. actualNanos is null because this API does not report invoice cost.

Official sources checked 2026-10-05:
- [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)
- [generateContent and usage](https://ai.google.dev/api/generate-content)

Standard text-only paid-tier prices for gemini-3.8-flash: input $0.75 / million and output including thinking $3.75 / million through 2026-12-31; documented 2027-01-01 rates are $1.50 and $7.50. Cached input is $0.075 / million, then $0.15. Central pricingFor stores effective revision/source/currency and nanos per token (750/3750/75, then 1500/7500/150). No batch/priority/flex/audio/tool pricing is assumed.

Prompt count includes cached tokens; noncached and cached are charged separately. Billable output normalizes candidate + thoughts tokens; reasoning is also retained separately without double counting. Missing required usage categories produce costState=unknown and null amount. A provider failure may retain measured usage and an estimated cost. Reported zero-token Google usage is a zero estimate, not an invoice; fake execution or a deterministic no-dispatch rejection can be known_zero. Unknown is never silently written as zero. Totals expose knownNanos plus hasUnknown, so a partial known sum is not a complete bill.

## Limits, budgets and transaction boundaries

Limits are bounded configuration/answers, 256,000 combined instruction bytes, 8,192 output tokens, 20 sections, per-section 40,000 characters, canonical response 512,000 bytes, provider response 1 MiB and at most three explicit attempts. Reservations conservatively estimate text input as UTF-8 bytes plus 8,192 envelope/schema token allowance, using the output limit and frozen rates. These are internal pilot controls, not a billing system or quota UI.

Live dispatch requires explicit AI_DAILY_BUDGET_NANOS and AI_ATTEMPT_BUDGET_NANOS. Store-row locking serializes budget admission and counts recent known costs plus all unresolved unknown liabilities (including older days). Days use UTC for internal accounting. Reservations are released/replaced only on a settled known result; ambiguous/stuck requests retain liability. Full organization/platform budgets, provider concurrency and rate-limit scheduling remain future work.

1. Transaction: authorize, Store lock, deduplicate/validate, snapshot Generation, reserve budget, create CLAIMED AIRequest + unknown UsageEvent + audit; commit.
2. Transaction: authorize and Store lock, compare durable CLAIMED state/policy, recheck current admission/customer revision, claim RUNNING; commit.
3. One external call, no open DB transaction.
4. Transaction: lock request, validate result, settle request/usage/Generation/audit atomically; commit.

A crash before/after dispatch or a settlement failure leaves durable PROCESSING/CLAIMED or RUNNING with unknown accounting. Replayed commands return that state and never redispatch. No lease expiry, blind recovery/retry or automatic restart is implemented. Operator reconciliation is required before an abandoned request can be released. This is duplicate-safe application execution, not exactly-once provider execution. Next queue work must preserve this uncertainty instead of resetting status and paying again.

## Idempotency and retry

A store-scoped UUID command key has a payload hash and a unique DB constraint. Same command returns its same Generation, including while preparing; changed parameters with the same key fail. A different simultaneous command cannot bypass per-reading active exclusion. Store locks plus partial indexes work across application processes; no process-local mutex.

Explicit failed-generation retry requires a new command key and the original Generation ID. It creates the next AIRequest and parent link, keeps the frozen context, revalidates current eligibility and forbids changed customer revisions, active work, ambiguous prior outcomes or attempts beyond three. Costs sum across distinct attempts. A settled timeout/network ambiguity cannot be retried by the temporary UI. Unknown cost from a definite malformed response may be retried explicitly within retained-liability budgets. Successful generations cannot be overwritten/regenerated in this slice.

## Development and acceptance

Set AI_PROVIDER=fake with ETSY_ADAPTER=fixtures outside production for deterministic dev content. Fake is also checked against the actual Store.source; it is rejected for real Etsy stores. Tests construct fake providers directly and never require a key/network. Tests support success, malformed sections, measured/unknown usage, provider failures and delayed responses. Fake content is not evidence of live quality/provider acceptance.

For live configuration set AI_PROVIDER=google, GEMINI_API_KEY, and explicit integer budget limits. AI_GENERATION_MODEL is optional, centrally allowlisted/priced. Do not set keys in NEXT_PUBLIC variables.

Normal pnpm test/test:db/typecheck/build never run a live call. An explicit one-request smoke path is scripts/live-generation-acceptance.ts: LIVE_AI_ACCEPTANCE=1 plus LIVE_AI_USER_ID/STORE_ID/UNIT_ID and a local isolated database whose name begins reading_os_acceptance, using synthetic eligible data. Run node --env-file=.env.local --import tsx scripts/live-generation-acceptance.ts. It prints only safe provider/model/token/cost/duration/schema/status metadata. Missing credentials skip only live acceptance.

Manual journey after migrations/seed: sign in through existing Auth.js dev flow; keep existing store/product/style; use a newly imported reading with an actual retained ProductVersion (do not rebind legacy fixture units); supply required fields/per-quantity allocation; Settings profile/current style; Order detail → Prepare reading; observe Preparing then Ready for review; inspect sections/reload; replay same command; test another Store's access; confirm original #2002 still Love ×2 + Career ×1 and three independent readings. No API/model controls appear in seller UI. Native/browser execution evidence and blockers are recorded in GENERATION_ENGINE_REPORT.md.

## Production worker integration — orchestration Part 3

Normal seller preparation remains owner-authorized. The server-only production executor uses a frozen, issuer-authenticated `ProductionAuthority` derived from an already fenced EXECUTING queue row. Structural/serialized authority is rejected; no seller session is fabricated. GenerationService's `prepareProduction` derives Reading/command identity from that authority and invokes the same generation pipeline as manual `prepare`. Queue UUID is the persisted command key. Queue→Generation association commits with Generation/AIRequest/provisional UsageEvent admission, under the existing Store lock. Prompt assembly, snapshot rules, validation, provider invocation, budgets and cost accounting are unchanged.

Gateway admission/dispatch revalidates current owned execution token and expiry; canonical/accounting settlement after authorized dispatch does not depend on later expiry. Production cannot call gateway/provider directly. Manual/worker races converge through Store locking and existing per-Reading Generation exclusion. Queue replay never redispatches EXECUTING; it only acknowledges persisted canonical outcomes. Unknown external execution remains nonreclaimable and cannot be inferred safe from lease expiration. See PRODUCTION_ORCHESTRATION.md Part 3 for crash windows and Part 4 recovery constraints.
