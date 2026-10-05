# Edge cases and V1 classification

Status: initial risk register, 2026-10-05.

Architecture-critical for V1 means identity, relationships, state or durable guarantees must account for the case now, even when the UI remains simple. Should support during V1 means the baseline operational handling must exist before production V1 launches. Safe to defer means a richer feature may wait; it must not invalidate the data model or remove a necessary safe hold.

## Architecture-critical for V1

| Case | Required architectural treatment | Acceptance evidence |
| --- | --- | --- |
| Several products in one checkout | Separate receipt/order, transactions/lines and units; aggregate order progress | Three lines/four units progress independently |
| Quantity >1, different recipients | Stable unit indexes and per-unit context revisions/allocation | Quantity replay produces no new units; ambiguous second recipient is held |
| Variants, optional/duplicate/reused SKUs | Store/listing and purchased offer/variation identity; explicit binding precedence | Missing SKU works; conflicting bindings block only affected units |
| Unconfigured products in mixed carts | Retain unautomated purchased units; do not generate by default | Configured siblings progress without hiding other purchases |
| Typed/multiple personalization, malformed/missing data | Raw source plus structured versioned inputs and validation | Several answers preserved; no single English-label assumption; missing required data blocks |
| Unicode, multilingual/RTL input | Preserve text, explicit language/date policy, compatible rendering | Names/answers survive ingestion, validation, content and PDF |
| Duplicate webhooks and polling overlap | Inbox deduplication plus canonical tenant/store-scoped upserts | Replays and overlapping reconciliation do not duplicate lines/units |
| Out-of-order/stale events, incomplete receipt fetch | Reconcile authoritative state; preserve source provenance; do not regress eligibility or infer deletion from partial data | Late paid event cannot restart a canceled unit |
| Double clicks, concurrent operators and jobs | Durable command keys, expected revisions, per-unit exclusion and fenced job claims | One logical generation for a repeated command; stale worker cannot overwrite selected output |
| Model timeout/crash after request | Durable operation/attempt states, uncertain charge/outcome and reconciliation | Ambiguous request is retained; no blind retry after lease expiry |
| Partial generation or malformed output | Accepted-content state separate from attempts; structured validation; bounded paid repair | Invalid/truncated content never becomes review-ready; every attempt accounted |
| PDF/storage failure | Independent document revision/render stage; retain accepted content | Document retry makes no model request |
| Delivery failure/unknown result | Delivery allocations, attempts, evidence, approval manifest, unknown state | Failed send does not rewrite generation; ambiguous send is not automatically repeated |
| Configuration/listing changes or removal | Purchased snapshot and pinned production revisions; retained external identity | Listing deletion cannot erase paid work; later template edit cannot change queued input silently |
| Authorization expiration/revocation/reconnect | Connection lifecycle separate from store; server token custody and refresh coordination | Auth failure holds affected integration work; reconnect preserves history |
| Refunds, partial refunds and cancellations | Source financial facts separate from unit eligibility and delivery; explicit allocation when scope unclear | Cancel holds queued work; ambiguous partial refund creates a hold/issue rather than guessing a unit |
| Tenant crossing and artifact leakage | Enforced ownership relationships and authorized jobs/private artifacts | Another tenant cannot read IDs, signed artifacts, bindings or usage |
| Historical imports and activation | Import watermark/cutoff, explicit eligibility/adoption policy | Old completed purchases do not silently trigger paid production |
| New content/document after approval | Approval tied to immutable revisions/hashes | Stale preview approval/delivery is rejected |
| Test production and regeneration costs | Attribution supports tests without a fake customer order; new logical requests remain distinct | Test/retry/regeneration usage all appears in cost ledger |
| Cancellation during paid work or send | Recheck before dispatch; preserve late results and costs; surface irreversible outcome | Canceled in-flight output is not automatically delivered; any already sent result is recorded |
| Untrusted instructions/uploads/assets | Bounded data, prompt separation, escaped/sandboxed rendering, controlled fetching | Buyer text cannot choose tools/recipient/tenant; unsupported assets are held |

## Should support during V1

| Case | Baseline behavior required for production V1 |
| --- | --- |
| Missing or ambiguous customer information | Needs Attention with per-field explanation, seller correction and provenance; clarification can be collected manually |
| Quantity requiring separate contexts | Phone-accessible per-unit allocation/confirmation; no presumed duplicate reading |
| No valid product mapping | Explicit seller mapping or unautomated/manual status, retaining purchased facts |
| Product/listing change detected | Show drift; hold new affected intake when identity/input rules changed; allow deliberate revision adoption |
| Deactivated/deleted listing with pending paid units | Preserve configured recipe/history; let eligible existing units proceed after confirmation; do not accept new unmatched work |
| Revoked auth and failed refresh | Show reconnect action; bounded retries; connection-scoped hold and rate-limited catch-up |
| Rate limiting or Etsy outage | Respect provider retry guidance, checkpoint sync, isolate tenant fairness, show last successful sync |
| Provider overload/known transient error | Controlled retry policy with budget/concurrency checks; exhaustion produces an actionable issue |
| Missing token usage or price | Record unknown/incomplete cost instead of zero; retain estimate and reconcile |
| Invalid/oversized model output | Deterministic schema validation; no automatic unbounded correction loop |
| Render failure or illegible Unicode pages | Retry only rendering; preview exact document; supported fonts/assets and size limits |
| Delivery unavailable or unverified API capability | Honest manual handoff with download and seller-confirmed evidence; no fabricated automated send |
| Refund/cancellation | Block unstarted affected work/delivery; preserve incurred costs and completed history; seller resolves ambiguous scope |
| Stale browser tab or interrupted mobile network | Conflict feedback and durable status lookup; retain command identity across retries |
| Worker restart, expired lease, stuck work | Recover/checkpoint deterministically; reconcile uncertain external attempts; operational issue if unresolved |
| Budget exhausted or anomalous retry spend | Hold paid work, show reason and remedy; do not silently switch provider or increase limits |
| Input/attachment type not yet supported | Show unsupported-input issue and a seller correction path; never drop the answer unnoticed |
| Accidental product activation | Tested immutable revision, clear scope and pause control; explain queued/in-flight effects |
| Customer data deletion request | Defined process covering stored artifacts/raw data/providers and retention exceptions; audited access |

## Safe to defer

| Feature/edge workflow | V1 fallback and architecture preserved |
| --- | --- |
| Full unattended delivery | Human approval; delivery policy/capability remains explicit |
| Buyer self-service clarification portal | Seller gathers information in Etsy and records per-unit corrections |
| Automatic interpretation of arbitrary free text | Deterministic field rules plus manual clarification; a future model extraction would be budgeted separately |
| Fully automatic partial-refund-to-unit matching | Hold affected/ambiguous remaining units; explicit seller allocation |
| Customer notification suite and autonomous replies | Seller handles communication; delivery/issue history remains durable |
| Native phone app/offline operations | Responsive web with online durable commands; do not promise offline sends |
| Team invitations and granular role-management UI | One-owner pilot; membership/permission model exists from V1 |
| Multi-store management UI | One-store pilot; tenant/store relationship and external uniqueness already support expansion |
| New product category engines | Generic recipe/template boundaries; V1 supports one bounded category path |
| Template marketplace/general plugin framework | First-party bounded configuration, no arbitrary execution |
| Combined multi-unit delivery packs | Individual handoff; allocations allow later bundling |
| Automatic model failover and provider optimization | One provider adapter; controlled gateway policy admits later adapters |
| Vector retrieval of seller examples | Small bounded explicit examples; provenance/tenant separation retained |
| Advanced business analytics and invoicing | Basic operations and internal usage ledger; no speculative charts or charges |
| Automatic replacement of already-delivered documents | Separate seller-approved revision and manual follow-up |
| Bulk approval/delivery/configuration | Individual phone-accessible actions; future bulk actions must retain per-unit outcomes |

## Minimum future test scenarios

Before a production pilot, demonstrate mixed checkout quantity expansion, duplicate event/command replay, cancellation followed by stale payment event, product edits after ingestion, generation success plus PDF failure, ambiguous provider timeout, ambiguous delivery, token revocation/reconnect, second-tenant artifact denial, and phone review/delivery using long Unicode customer input. These are implementation acceptance scenarios, not instructions to create test code during the documentation phase.
