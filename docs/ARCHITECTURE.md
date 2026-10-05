# Architecture proposal

Status: foundation plus Milestone 1 implementation decisions, 2026-10-05. The broader production model below describes future direction, not tables already created. Current implementation is documented in MILESTONE_1_PLAN.md and MILESTONE_1_REPORT.md.

Approved and implemented direction: TypeScript, pnpm, Next.js App Router, PostgreSQL, Drizzle ORM, Zod, Auth.js and Vitest. One modular monolith. Auth.js is installed and the public/auth/onboarding integration passes local runtime/build checks; production authentication policy remains a launch decision. Sync jobs are PostgreSQL-backed behind BackgroundJobs; storage has a PrivateObjectStorage port only because this milestone creates no artifacts. No Redis or AI/PDF/delivery tables. PostgreSQL composite ownership constraints plus scoped application services enforce tenant isolation; RLS is not implemented and remains a possible defense before deployment.

## Architectural recommendation and critique

Use a modular monolith, one relational database, private artifact storage, and durable asynchronous work. Web/API and worker can be separate processes sharing domain modules and a deployment release. Avoid microservices until independent scale or ownership justifies them.

The proposed apps/packages/docs layout is reasonable only once actual runtimes exist. `web`, `API`, and `worker` are runtime roles; database, Etsy, generation, documents, and usage are domain/infrastructure boundaries. Turning every name into a package or service now adds interfaces, build tooling, and cross-service failure modes without product value. A web framework may host the API; a dedicated API app is not inherently required. Extract shared UI only when there is real reuse. A logical database ownership boundary does not require an ORM package.

Actual structure: src/app for Next.js views/actions/routes, src/components for shared UI, src/modules for domain/application services, src/infrastructure for ports/adapters, src/db for Drizzle schema/client, drizzle/ for migrations, scripts/ for migration/seed/worker, tests/ for behavior checks, docs/ for specifications. pnpm is now selected. No apps/packages split is needed.

## Initial domain model

All tenant-owned records carry organization ownership, directly or through an enforced relationship. Store-scoped entities also carry store ownership where queries or attribution need it. Listed concepts need not each be a separate table; durable provenance and constraints matter more than table count.

| Concept | Relationships and responsibility |
| --- | --- |
| User, Organization, Membership | User belongs to organizations through authorized memberships; organization is the tenant |
| Store | Organization owns stores; external shop identity remains stable across reconnects |
| EtsyConnection | Store authorization, granted scopes, encrypted credentials, expiry, health, sync cursor; historical grants may be retained without retained secret material |
| ListingSnapshot | External listing ID, state, variant/offer information, optional SKUs, personalization schema, source time/fingerprint; not the internal product |
| Product, ProductRevision | Internal production identity; draft, tested, active, paused, retired lifecycle; immutable published recipe references input schema, reader revision, content template, document template, execution/review policy |
| ListingBinding | Store/listing and specific offer/variant or explicit default -> product revision policy; versioned mapping, unambiguous precedence |
| ReaderIdentityRevision | Tone, persona, examples, terminology, style constraints and branding references; may serve multiple products |
| ContentTemplateRevision | Semantic output sections/schema and content instructions |
| DocumentTemplateRevision | Layout, assets, fonts, page settings and renderer compatibility; independent of content template |
| Order | Store and external receipt identity; payment, cancellation, refund facts, source timestamps and order totals; aggregate fulfillment progress is derived |
| LineItem | Order and external transaction identity; purchased listing/variant snapshot, original quantity, amount/currency, raw personalization; survives listing removal |
| FulfillmentUnit | Line item and stable unit index; eligibility, pinned recipe/context, production and delivery projection; one independently produced purchased unit |
| CustomerContextRevision | Structured inputs, raw-source references, language, per-unit recipient allocation, validation results, correction provenance |
| Generation | Fulfillment unit or explicit product test context; immutable production snapshot, logical request key, revision, state, accepted structured content; multiple historical generations per unit |
| ModelOperation, ModelAttempt | Logical production operation and each physical external request, including retries; provider outcome and cost/usage ledger references |
| DocumentRevision | Generation, accepted content hash, visual-template revision, render attempt/outcome, private artifact reference and checksum; multiple documents/revisions allowed |
| Approval | Actor, time, selected generation and exact document revisions/hashes; rejected/superseded approvals retained |
| Delivery, DeliveryAttempt, DeliveryAllocation | Logical handoff, channel/recipient, approved artifact manifest; attempts record external outcome; allocations link each covered unit/document, including bundles |
| OperationalIssue | Typed blocking/recoverable reason, affected resource, remedy, lifecycle; Needs Attention is a projection of these issues |
| AuditEvent | Actor/system action, tenant, target, time, correlation and redacted change provenance |
| ExternalEventInbox, DurableWork/Outbox | Verified event deduplication, recoverable scheduling, leases, attempt limits, integration reconciliation |
| UsageLedger, PricingRevision, BudgetReservation | Attempt-attributed measurement, versioned estimate basis, budgets and unknown-liability tracking; see COST_MODEL.md |

Avoid a universal customer CRM or a generic workflow language in V1. Context revisions and operational issues solve the immediate requirements. Store examples and uploaded assets with access/retention provenance; a vector database is not necessary for a few seller examples.

### Cardinality and immutable facts

Order 1:N LineItem; LineItem with purchased quantity N has N stable FulfillmentUnits; FulfillmentUnit 1:N Generations; Generation 1:N DocumentRevisions. Delivery covers approved documents through explicit allocations, permitting separate unit delivery or a later combined order package without redefining the unit model.

For Love x2, Career x1, Future x1: one order, three lines, four units. Generation and delivery never use order ID alone as their work identity.

Capture purchased facts at ingestion; the API may provide only current listing metadata, so record provenance and avoid presenting it as proven purchase-time configuration. Pin the resolved product/reader/templates, platform-rule revision, normalized context revision, selection data, execution policy, provider policy and schema version before the first model operation. Config edits cannot rewrite that snapshot. Historical unmapped orders require an explicit mapping decision before production.

Source corrections are recorded as revisions. Reductions/cancellations retain unit indexes and history; never delete generated units or renumber them. Do not infer which unit a partial refund cancels unless Etsy supplies that scope or the seller explicitly allocates it.

## Ownership boundaries

| Module | Owns | Must not do |
| --- | --- | --- |
| Identity/tenancy | Authentication, membership and tenant/store authorization | Accept client ownership assertions as authority |
| Etsy adapter | OAuth, API rate limiting, event verification, raw-to-canonical conversion, sync | Generate content, choose ambiguous mappings, expose tokens |
| Catalog/configuration | Products, binding resolution, typed recipes, revision publication/tests | Mutate historical generation snapshots |
| Orders/fulfillment | Purchased facts, units, eligibility, context validation, workflow orchestration | Call model SDKs directly or mark an entire cart fulfilled after one unit |
| Generation | Deterministic request composition, structured content validation, controlled gateway | Render presentation, deliver, authorize from model text |
| Documents | Escaped deterministic rendering, private storage, document revisions | Repeat model calls to recover a render failure |
| Review/delivery | Artifact-specific approval, channel capability checks, allocations, delivery attempts | Send unapproved/stale artifacts or treat download as delivery |
| Usage/cost | Reservations, measurements, pricing versions, reconciliation | Decide a product's content structure or silently discard uncertain charges |
| Operational projections | Work lists, issues, aggregate progress, audit visibility | Become an independent source of workflow truth |

Orchestrate through application services and narrow contracts. Shared transaction coordination may atomically create unit state, idempotency records and durable work. Do not hold database transactions open across network calls. Persist intent, invoke externally outside the transaction, then persist outcome with concurrency checks.

## State and eligibility

Keep payment, cancellation/refund facts, production, review, and delivery separate. Example production phases: waiting_mapping, waiting_input, ready, queued, producing, rendering, review_ready, failed, held. Separate approval state: pending/approved/rejected/superseded. Delivery: not_started, queued, sending, confirmed, failed, unknown. These are proposed enums; implementation may use phase plus typed issue rather than an ever-growing status enum.

An order's progress is derived from units; payment/refund source facts are not inferred from production. A successful generation does not imply a successful PDF, approval, or delivery. A source `order.delivered` notification does not prove this platform's unique artifact reached the customer.

Guard transitions in server commands: tenant permission; unit eligibility; selected configuration/context revision; expected resource version; active job exclusion; budget; approval manifest; channel health. Recheck eligibility before costly requests and dispatch. Cancellations received during external execution cannot erase already incurred cost or retract a sent artifact; retain the late outcome and flag it.

Generation retries within the same logical request are distinct attempts; an explicit seller regeneration is a new generation. Rerender creates a new document revision using retained accepted content. New selected content, context, or document invalidates prior approval. After delivery, replacement/resend is a separate audited action, never a silent update.

## Idempotency and concurrency

- Suggested unique keys: store + receipt ID; order + transaction ID; line item + unit index; provider/event ID where available; organization + action + client idempotency key. Use payload hashes to reject the same command key with different parameters.
- Binding precedence: exact verified offer/variant identity, then explicit configured variant signature, then seller-authorized listing default. SKU may aid diagnosis but is not identity. Ambiguity holds the unit.
- Deduplicate verified event transport separately from canonical receipt upserts. Events can have distinct IDs for the same business change. Out-of-order notifications trigger authoritative receipt reconciliation and never blindly regress cancellation/payment facts.
- On valid event receipt, durably record before acknowledging. Process asynchronously. Validate resource URLs against expected Etsy host/path/shop or construct URLs from validated identifiers; signed payloads do not waive SSRF defenses.
- Atomically claim generation intent with per-unit exclusion and an expected version. Lease work with fencing/version checks so an expired worker cannot publish over newer work. A worker timeout does not prove a provider request never ran.
- Use a transactional outbox or equivalent database-backed durable job insertion to avoid committed state with lost scheduling. A separate broker is optional, not a V1 prerequisite.
- Retry transient failures with bounded backoff and jitter; terminal/ambiguous failures produce an issue. Reconcile stale jobs, unknown external outcomes, failed scheduling and missed Etsy updates. Exactly-once effects cannot be guaranteed by a queue alone.

Use periodic, rate-limited reconciliation even with webhooks. Define the first import cutoff and overlap window so historical fulfilled orders are not accidentally generated. Track source sync time/cursors separately from business timestamps; partial API fetches must not imply deletions or replace complete snapshots.

## Etsy feasibility and trust

Official sources checked 2026-10-05; reverify against approved app capabilities before implementation:

| Source | Verified statement | Architectural consequence |
| --- | --- | --- |
| [Application access](https://developers.etsy.com/documentation/) | Broader seller SaaS access has a Personal App / Commercial Access path; a Seller App is for the owner's shop | Access approval is an external launch gate; own-shop testing is not proof of commercial availability |
| [Authentication](https://developers.etsy.com/documentation/essentials/authentication/) | OAuth authorization code with PKCE and scoped consent; scope names do not guarantee an endpoint exists | Server token custody and an endpoint-level capability matrix are required |
| [Webhooks](https://developers.etsy.com/documentation/essentials/webhooks/) | Signed order notifications are documented; the listed events do not cover every required change | Validate raw-body signatures/replay windows; use reconciliation for missing facts, including refunds |
| [Personalization migration](https://developers.etsy.com/documentation/tutorials/personalization-migration/) | Typed listing questions and multiple transaction personalization entries replace single-field assumptions | Do not parse one fixed English label or a single answer; preserve typed/raw input and upload references |
| [Listing files](https://developers.etsy.com/documentation/tutorials/listings/) and [fulfillment](https://developers.etsy.com/documentation/tutorials/fulfillment/) | Listing file upload is listing-scoped; fulfillment tutorial describes ready-made digital downloads | These pages do not establish a unique made-to-order attachment API; automated personalized delivery remains unverified |
| [Creativity standards](https://www.etsy.com/legal/creativity/) | Seller-prompted AI creations require disclosure | Operations-focused UX must coexist with seller disclosure obligations |
| [Services policy](https://www.etsy.com/legal/policy/services/242665313101) | Eligible divination readings require a tangible/digital deliverable and cannot advertise prohibited metaphysical outcomes | Category eligibility and seller output/listing policy must be defined before launch |

Do not claim an unavailable messaging or made-to-order completion API is supported. Verify actual endpoints, scopes, attachment limits, receipt completion semantics, buyer contact availability, and permitted channels. Do not upload one buyer's private reading to a listing shared by other buyers. Email access may require additional approval; it is not a default assumption. Manual seller handoff is the conservative initial fallback, pending product agreement.

Proposed read-only capability matrix, subject to endpoint validation: shops_r to identify the shop where needed, listings_r to import non-public listings, transactions_r to read orders. No listing-write/delete, address access, or delivery-write scope by default. Add scopes only after a demonstrated feature and separate consent explanation. Show requested and granted scopes, shop identity, last sync, healthy/reconnecting/reauthorization_required/disconnected status, and the effect of disconnect.

Disconnect immediately disables new integration work and automatic sends, removes locally usable credentials, and explains whether remote revocation also occurred. Reconnection preserves store history and requires ownership validation. Serialize refresh per connection and persist rotated credentials safely; repeated authorization failures hold integration work rather than looping. App-wide and per-store rate limits prevent one tenant from exhausting shared access.

## Security and privacy

Tenant-aware queries, composite relationships/constraints, and authorization on artifact access are mandatory. PostgreSQL row-level security is a candidate defense, not a substitute for application checks; choose and test the isolation mechanism before implementation. Queued jobs revalidate ownership and current permissions/eligibility. Support operators have audited, narrowly granted access, not unrestricted implicit impersonation.

Use secure sessions, CSRF protection for commands, single-use OAuth state tied to user/tenant/store intent, PKCE, exact registered redirects, server-side encrypted token storage, and separately managed key material. Keep secrets out of URLs/logging/telemetry and API responses. Reauthorize approval/delivery commands; model output is never executable authority.

Treat customer data and seller examples as untrusted prompt data. Use bounded input/output and explicit schemas. Escape HTML/Markdown; disable arbitrary script execution, remote asset fetching and local filesystem access in document renderers. Validate type/size and malware exposure for uploads; unsupported attachments are held, not silently fetched. Fonts and deck art require usage rights.

Private object storage with tenant ownership metadata and short-lived download access is preferred. Public predictable document URLs are prohibited. Define retention and deletion across context, raw payloads, documents, model logs, backups and audit records before real data; retain minimal cost/audit facts without retaining unnecessary personal content. Review provider data retention/region commitments and avoid sending entire receipts, addresses or tokens to a model.

## Observability and recovery

Correlate tenant/store/order/unit/generation/job/operation/attempt/delivery IDs through redacted logs. Record state transitions, latency, queue age, auth health, validation failures, unknown provider outcomes, and usage. Recover from worker restarts without replaying completed billable operations. Alert on stuck work, budget breaches, unreconciled unknown costs, failed refresh, and unexplained delivery outcomes. Choose backup/restore objectives and test restoration before live operation; do not invent service-level guarantees yet.

## Decision register

| Decision | Recommendation | Status / gate |
| --- | --- | --- |
| Language | TypeScript | Approved |
| Relational database | PostgreSQL with composite ownership/uniqueness constraints | Approved; Drizzle schema/migration implemented |
| System shape | Modular monolith; Next.js app plus script worker | Approved; hosting still undecided |
| Web/server framework, package manager, ORM | Next.js, pnpm, Drizzle; Zod contracts; Vitest | Approved |
| Auth provider and membership scope | Auth.js JWT sessions; configured GitHub OAuth, guarded development accounts/demo credentials; owner/operator membership | Locally validated; production IdP and account lifecycle policy still need confirmation |
| Jobs | SyncRun implements durable PostgreSQL queue behind BackgroundJobs | Implemented; no Redis required |
| Hosting, key management, storage, region | Private objects, server-held keys, operationally simple deployment | Undecided; privacy and restore gates |
| Model provider/model | None in Milestone 1 | Deferred |
| PDF renderer | None in Milestone 1 | Deferred |
| Etsy access and scopes | Appropriate approved app with minimum verified endpoint scopes | External feasibility gate |
| Delivery channel | Verified order-specific API or explicitly manual seller handoff | Unresolved product/technical gate |
| Billing/limits | Internal cost ledger and caps before monetary customer billing | Pricing, cap values and currency undecided |
| Product execution policy | Review required; valid-input auto-production optional per product | Confirm before first billable workflow |

## Contradictions, missing concepts, and risks

- Desired delivery automation exceeds what the consulted listing/fulfillment docs establish. Resolve with capability proof, not a generic delivery button.
- Internal AI branding is compatible with a professional UX, but not with concealing required seller disclosures. Do not present synthetic content as a verified human reading.
- Listing configuration after purchase may differ from purchase-time facts. Preserve provenance and require explicit adoption of recipe changes rather than silently applying current listing data.
- Quantity >1 lacks a customer-context allocation rule. Stable units solve identity; product policy and seller confirmation solve meaning.
- Reader identity, listing bindings, input revisions, tests, approvals, issues, delivery allocations, usage attempts and budget reservations are missing from the original runtime-domain list; they are needed as concepts, not standalone services.
- Broad category extensibility can become a speculative plugin platform. Use bounded typed recipe data and optional capabilities first.
- Mobile PDF review and concurrent operator actions can undermine approval correctness. Preview exact artifacts, preserve resource versions, and authorize on the server.
- Provider timeout plus job retry can duplicate charges. Unknown-outcome handling is a first-class operation state; see COST_MODEL.md.

## Initial onboarding persistence

`modules/onboarding` coordinates existing identity, connection and job boundaries. A constrained `stores.onboarding_stage` tracks `etsy`, `products`, `product_setup`, or `complete`; the migration defaults existing stores to complete so Milestone 1 workflows are preserved. New onboarding store creation explicitly starts at Etsy, under the existing user-row lock. Operational session scope redirects unfinished stores to their saved next step; onboarding scope still validates membership independently.

`listing_selections` records seller intent separately from `listing_mappings`. Composite organization/store/listing foreign keys and uniqueness enforce isolation and replay safety. Selection requires owner authorization, a connected shop and active imported listings. Replacement and progress transition share a transaction and store lock, with an audit event only when selection changes. It does not configure products or mutate orders/readings. Product setup completion is an explicit command gated on at least one selected active configuration; selection alone never completes it.

Import orchestration reuses the PostgreSQL job port, connection epoch and fencing. Live import remains gated by ETSY_INTEGRATION.md. Connection DTOs explicitly select only safe presentation fields; encrypted tokens never reach client props.


## Public entry, identity and onboarding resolution

The root server route dispatches by trusted persisted seller state. Logged-out visitors get the public Landing without a tenant query or operations layout. Completed sellers get the unchanged operational Home/shell at the same `/` URL. Incomplete sellers redirect to their next onboarding step. `(public)` owns `/sign-in` and `/sign-up`; `(operations)` remains protected, and onboarding has its own minimal authenticated shell.

`modules/onboarding/destination.ts` is the single resume resolver: no identity → public; no store → store setup; explicit completion → Home; unavailable/expired connection → Etsy; no selections → Products; saved selections → Product Setup. Selection never implies configured products or completion. An explicit completed legacy store still reaches operations even when disconnected, where connection problems remain actionable. Pages may allow backward review of onboarding steps; they do not invent completion. Membership and store authorization remain server-side.

`app_users.email` is nullable and unique; `password_hash` is nullable for OAuth/demo identities. Individual development accounts have random namespaced IDs and versioned salted scrypt hashes. Replay of registration only reuses an email identity after verifying its existing password, never overwrites a credential, and creates no workspace. Existing transactional store initialization supplies Organization/Store/Membership later and remains replay-safe.

Auth.js owns authentication, JWT sessions, cookies, provider callbacks and logout. No parallel session implementation exists. Email credentials and registration require **all** of non-production runtime, `DEV_ACCOUNT_AUTH_ENABLED=true`, and the synthetic Etsy adapter. The gate is checked again in the application service and Auth.js provider. Production does not accept these credentials even if the flag is accidentally enabled. GitHub OAuth remains genuine and conditional on both configured credentials; no Google provider is advertised. Auth.js Credentials does not persist accounts itself; see its [official provider documentation](https://authjs.dev/getting-started/authentication/credentials).

Before production email registration, approve identity-provider/account policy and implement verification, recovery/reset, and login/registration abuse controls. The current boundary must not be promoted by simply removing the environment gate. Logout terminates only the Auth.js session and returns `/`; it does not reset onboarding or delete business data. No dependencies or intake/connection services changed for this integration.

## Product configuration implementation

[PRODUCT_CONFIGURATION.md](PRODUCT_CONFIGURATION.md) is the current implementation contract. `modules/products` owns two relational tables (Product, ProductVersion) and bounded version-owned JSONB inputs, content sections, output and workflow. The core is generic: tarot-specific inputs/sections are seller data. Existing ListingMapping gains a tenant-owned Product reference; existing FulfillmentUnit gains an immutable ProductVersion reference and explicit legacy/unconfigured/versioned provenance. Exact variant matching, SKU metadata, existing CustomerInput revisions and deterministic intake triage are reused. No second mapping, parser or readiness state engine exists.

Store-row locks serialize publish/intake. Activation archives the former active version and changes the owned active pointer atomically. Partial unique indexes, composite foreign keys, immutable-version/unit triggers and deferred pointer checks enforce historical safety. New orders bind the version effective at ingestion; replay never adopts current configuration. Existing M1 data is preserved as legacy checks rather than fabricated configured products.

The onboarding Product Setup boundary is now real. One selected, active configured product permits explicit persisted completion; remaining selections need not be configured. Production engines, document rendering, automatic execution and style identity remain deferred. Technology choices for those future engines are unchanged and undecided.
