# Review Workspace — Complete (Parts 1–4)

Review is entered through Orders, with no primary navigation change. Sellers can read a prepared Reading and the customer details used for it. Part 2 adds section-body editing and explicit durable draft saving. Part 3 adds immutable approval. Regeneration, documents and delivery are not implemented.

## Durable foundation

One reading_reviews row per owned Reading pins the exact successful Generation. At the Part 1 boundary PENDING was the only review lifecycle state: it means seller review is still pending, distinct from successful preparation. Part 2 seller draft content lives separately from this immutable base; Part 3 approval is stored separately from the original pin and draft content, as described below. We deliberately do not invent document or approval states in Part 1.

Admission is lazy on first workspace entry under the Store row lock, after persisted membership and Store/Order/Line/Reading ownership checks. Concurrent entries create one base. Orders eligibility reads never create reviews, and Review links disable prefetch. No historical backfill. Composite foreign keys bind the same organization, Store, Reading and Generation; a unique constraint protects one base, and database triggers reject non-successful evidence and changes to the original pin. Original Generation/context/result and AI accounting remain untouched.

## Eligibility and stability

A current successful Generation with completed timestamp and canonical result is required. Hash, context version, product/style/seller/customer revision bindings, product input definitions, bounded answers and exact product section contract are validated on read. Forged, missing, corrupt, failed or processing evidence fails closed. Existing reading holds, order payment/cancellation/refund holds and source changes also block entry. Production ATTENTION, EXECUTING, CLAIMED and RETRY_WAIT block entry; an undispatched QUEUED intent alone cannot override a successful validated seller-prepared reading. This is important because the existing owner preparation path can finish while its queue intent remains QUEUED. No orchestration behavior was changed.

Before initial admission, successful preparation must match the current customer revision. After a pin exists, review continues to use its original evidence and frozen customer details, even if a later successful Generation exists. A newer processing/failed attempt or production problem blocks display without changing the pin. No floating latest-result replacement, regeneration action or automatic provider call.

## Seller experience

Route: /orders/[id]/readings/[readingId]/review. Current scope is derived server-side; the URL accepts only Order/Reading identities, never Store or Generation identities. Unavailable/corrupt/foreign readings map to the existing safe not-found experience. Orders displays Ready for review and Review reading only after domain eligibility, replacing inline prepared-content display.

The workspace uses existing Heading, Badge, button/back-link and operational shell patterns. Customer name, purchased product title and order reference identify the task. Quantity greater than one adds Reading n of quantity; mixed-cart lines and quantity units are independently pinned. Customer details come from the pinned GenerationContext, labelled by its retained ProductVersion input definitions; missing optional details say Not provided. The reading renders validated sections in deterministic product order without IDs or raw metadata. Text is escaped, intended line/paragraph breaks preserved, with Part 2 editing and Part 3 approval controls described below.

The document column is limited to 72ch, with long strings wrapping anywhere. Customer details use a grid whose minimum fits the container; existing responsive headers stack on phones. Semantic headings, labelled sections/article, text status and keyboard links reuse accessible primitives. SSR/structure tests verify semantics and responsive constraints; native browser viewport QA is not claimed.

## Migration and validation

0013_flat_prodigy adds reading_reviews, owned composite generation identity and immutable review-base guard. Historical rows are preserved; no review records fabricated. Existing migration replay/repeat-no-op and production historical-data preservation suites remain active. New domain/DB tests cover pinning, concurrency, original immutability, later evidence, tenant and sibling Store isolation, forged relationships, missing/failed/processing/problem/corrupt data, mixed carts and quantities. Render tests cover frozen labels, optional/long answers, canonical order, escaped text, metadata exclusion, Orders links, semantic landmarks and responsive structure.

Real Gemini calls: 0. The following Part 2 section describes its original boundary; Part 3 is documented below.

## Part 2 — seller-owned durable drafts

reading_review_drafts is a separate table with one row per owned immutable reading_review, JSON sections, integer revision and updatedAt. It has an owned composite foreign key to the review. The review's pinned Generation remains the sole origin; neither review pin/state nor original generated reading/context, customer inputs, style or AI accounting is changed by editing. Review remains PENDING: no IN_REVIEW or approval state is introduced. Orders keeps Ready for review / Review reading.

Read mode defaults to saved draft content when a draft exists, otherwise original evidence. Edit reading opens the same route with validated edit=1. First edit initializes revision 0 from the exact pin under the Store lock; concurrent entry creates one row. Subsequent entry never resets saved content. Merely opening edit mode and canceling may leave an unmodified revision-0 row; unsaved body changes are never written by Cancel. No autosave.

The explicit Save changes server action derives scope from authenticated membership, rechecks Order/Reading ownership and current Part 1 eligibility, loads the exact review/draft and validates the entire submitted section set against pinned evidence. It accepts body text only: section count, identity, order and titles remain fixed. Strict Zod rejects unknown fields and malformed bodies. Each body is nonblank and at most 40,000 UTF-16 code units, at most 20 sections, serialized aggregate at most 512,000 UTF-8 bytes; action prechecks count, field types and aggregate before construction. Native Next server-action request size limits remain in place. Text whitespace/newlines are preserved without HTML interpretation.

Saving uses the loaded expected revision, Store/row locks and a revision-conditioned update. Each successful save increments once. Another save first causes a seller-safe conflict and cannot overwrite it. The form retains controlled typed text on errors; a successful save redirects to readable mode with restrained Changes saved feedback. Cancel confirms discard when dirty; a native beforeunload warning covers browser reload/close. The edit surface omits the separate Order back link to keep Cancel the clear exit. No fragile global interception of all SPA navigation is implemented; browser-history navigation is not universally guarded.

Effective modification is computed from validated saved content versus the normalized pinned canonical sections using stable JSON comparison. There is no drifting modified flag: restoring exact original bodies yields modified=false. Every read validates saved structure before displaying it. SQL guards prevent draft identity reassignment/deletion/reset, require revision progression, and bind section identities/titles/order to the pinned reading. Initial SQL content must equal pinned evidence. Historical Part 1 reviews remain valid without drafts; migration 0014_sad_orphan is additive and does no backfill.

Each mixed-cart or quantity Reading has an independent draft/revision. Reads and writes are Store-scoped; no client Store/review/Generation identity grants ownership. Customer context remains read-only. Seller text uses normal escaped rendering in view mode and native labelled textareas in edit mode, with responsive widths/wrapping, existing touch-target buttons, keyboard Cancel/Save and announced errors/loading. Mobile coverage is rendered structure/CSS, not a claimed live viewport run.

Part 2 deferred approval/final content; Part 3 below adds it. PDFs, delivery, regeneration, rewriting, proofreading and rich editing remain deferred. No provider call, prompt/style change or production redesign accompanies saving.

## Part 3 — immutable approved reading

The current workflow is: original immutable Generation → immutable review pin → optional mutable seller draft → immutable approved reading. Approval and future document rendering are separate. Part 3 implements approval only; no PDF, delivery, reopening or provider call.

The approved artifact is stored directly on reading_reviews: approved_content (ordered strict sections), approved_draft_revision (nullable), approved_content_hash, approved_at and approved_by_user_id. Existing owned review/Reading/Generation relationships remain its provenance. One row holds both status and artifact so a single transactional update cannot leave a partial approval. Existing PENDING rows and drafts are preserved without backfill. No separate audit subsystem or approval history is introduced.

Approval requires the same current durable eligibility and owned pinned successful evidence as review. The server selects saved draft content whenever a draft exists, including an unmodified revision-0 draft; otherwise it selects pinned canonical content. It validates saved structure and never accepts section text, titles, provenance or hashes from the approval action. The page submits only its expected saved revision, or an explicit no-draft token. A newly created/saved draft invalidates a stale page. Stale approval returns a safe conflict and requires the seller to review the latest saved content.

Store-first locking coordinates admission, saving and approval. Approval changes PENDING → APPROVED once. Concurrent or repeated consistent approvals return the existing artifact, with no replacement or extra snapshot. Draft content and revision are unchanged. The content hash is SHA-256 over stableJson of ordered section IDs, titles and exact bodies; timestamps/provenance are outside this semantic content hash. Reads validate the approved contract and hash and fail closed on corruption.

Migration 0015_stale_omega_sentinel is additive. SQL checks require PENDING to have no approval fields and APPROVED to have complete content/hash/time, with a nonnegative draft revision when used. The review trigger preserves all original identity and Generation provenance, allows only the one-way transition, binds approval to the exact current saved draft/revision or original result, and forbids updates/deletion afterward. Draft writes lock the owned review and require PENDING; approval and draft mutation cannot safely cross. Existing draft structural/revision guards still apply. Canonical Generation, context, customer inputs, product/style and accounting history are untouched.

The readable workspace has Edit reading and Approve reading. Approval opens an inline, labelled confirmation form explaining that the reading can no longer be edited. It supports keyboard focus, Cancel, pending text and announced errors. Active editing has Save/Cancel only; unsaved browser content cannot be approved. Approved workspace content comes from approved_content, never draft content; editing and draft initialization are blocked. Orders marks individual readings Approved / View reading. Mixed carts and quantity units remain independent; an order is labelled Approved only when every reading is approved, without any order-wide approval action.

Responsive document layout and native forms/buttons reuse locked primitives. Long text stays escaped and wrapped. Automated coverage checks markup/CSS structure; a native phone viewport run is not claimed. Part 3 deferred Part 4; Part 4 is completed below. Document/PDF Engine remains deferred. Real Gemini calls: 0.

Approval records the authenticated actor using the existing stable app_users identity and nullable additive foreign key. No actor is fabricated for historical PENDING reviews; approved actor identity is immutable and is not displayed to sellers.

## Part 4 — REVIEW WORKSPACE COMPLETE

The complete domain lifecycle is Generation → lazy owned review admission → optional persisted seller draft → immutable approval → approved Reading → validated document handoff. Review owns the original evidence pin, seller corrections and approval. No later/latest body enrichment is permitted. Approval remains a per-Reading fact; mixed carts and quantity units progress independently.

### Stable document-input contract

`getApprovedReadingForDocument(db, scope, orderId, readingId)` is a local server/domain read. It verifies persisted membership and Store/Order/Line/Reading ownership in one repeatable-read transaction, checks existing operational holds and validates pinned successful evidence and context/hash bindings. Only APPROVED can return. Missing, pending, draft-only, foreign, malformed or inconsistent data raises bounded ReviewUnavailable; nothing is silently repaired.

The strict `approved-reading/v1` DTO contains organizationId, storeId, readingId; owned order id/reference/customer display name; purchased product display name; operational readingNumber/quantity; exact approved ordered section IDs/titles/bodies; validated contentHash; approvedAt ISO string; reviewId and pinned generationId as minimal provenance. Display metadata comes from owned purchased order/line facts; it is not a document snapshot. The future document layer must snapshot any metadata/design it uses alongside this approved body/hash. Customer details remain visible in Review from the frozen generation context, but no full customer answers or infrastructure state are automatically included in this handoff.

Reading numbering is operational metadata, not an instruction to print customer-facing numbers.

The returned value is Zod-validated, detached from persistence objects and deeply frozen, with a TypeScript deep-readonly type. No mutable Date, draft revision/content/editing API, accounting, provider, prompt, style intelligence or queue data is returned. The future document layer never needs to know whether the seller edited. Only the approved artifact supplies section bodies. A latest-generation status lookup preserves existing operational eligibility precedence, but never supplies handoff content. The contract performs no review admission, save, approval or provider execution.

The contentHash contract remains SHA-256 over UTF-8 stableJson of `{sections:[{sectionId,title,content},...]}`. Object keys use existing stable serialization; section array order and exact body whitespace are significant. Approval time and provenance are excluded. The approved-reading/v1 contract locks this meaning; a future incompatible hash interpretation requires explicit versioning. Document artifacts will bind this validated semantic hash separately from their layout/artifact checksum.

### Concrete hardening

Orders previously validated original evidence but could offer Review reading for malformed saved drafts, while opening the workspace then failed. Both status and eligibility now validate the current effective PENDING content. Canonical-only approval provenance is also checked against exact pinned content, with finite approval time and nonnegative safe draft revision checks. Approved display/handoff remains independent of mutable draft content.

Orders previously ran review availability and approval status through two complete query paths for eligible readings. Each reading now resolves a single status in one repeatable-read transaction; availability and Approved derive from that same value. One reading's queries use owned unique identities and latest-generation LIMIT 1, without loading historical generations, style sources or draft history. The application still has its pre-existing whole-Store Orders dataset and per-reading status checks; pagination/batch projections are general scaling work, not silently claimed solved here.

Review constraints/triggers in 0013–0015 compose correctly: lazy admission, unique owned review/draft, immutable pin, canonical initial draft, exact section structure, revision progression, complete atomic one-way approval, immutable approved fields/actor and post-approval draft locks. NO MIGRATION REQUIRED. Existing replay/repeat-no-op coverage remains active.

### Acceptance and deferred document responsibility

Local integration/route/action tests cover canonical and edited approval, exact handoff, ownership, corruption, stable hashes, late generations, mutable draft independence, stale save/approval, cancel's non-persistence, post-approval locks and mixed-cart/quantity independence. Seller feedback remains bounded; no SQL/Zod/IDs/hash/provider/queue errors are reflected. Native textareas, text statuses, confirmation focus/Cancel, pending disabled controls and announced feedback remain in place. No UI redesign or primary navigation change.

Native in-app browser viewport checks used synthetic static markup rendered from the actual ReviewReading and ReviewDraftForm components with repository CSS, at 390×844 and 1440×900. Reading/view and edit fields fit both widths with scrollWidth equal to viewport width; long labels, customer answers, URLs, Unicode, HTML-like text, quantity labels and paragraphs were exercised. This is component viewport acceptance, not hydrated application authentication/save/approval end-to-end browser testing or physical-device/screen-reader certification. Durable lifecycle acceptance uses the application services and route/action tests with synthetic local data.

Future boundary: approved Reading + document configuration/template → immutable document snapshot → paginated preview/render → PDF artifact. The Document/PDF Engine owns controlled seller customization (not a Canva-like editor): professional template selection, logo, brand name, primary/accent colors, controlled fonts, cover/footer/display options, reusable saved designs and product→design assignment. It must offer a realistic paginated preview and a real approved-Reading preview before PDF creation. Preview and final PDF must share one deterministic layout/rendering model to avoid drift. None of those responsibilities is implemented by Review Workspace.

PDF/document rendering, design UI, branding, assignment, delivery, Telegram, billing, regeneration/reopening and approval histories remain deferred. Real Gemini calls in Part 4: 0. Review Workspace is complete within this milestone's scope; general deployment/access/retention/scaling gates remain separate.


## Reading Media — Part 2.5B

Part 2.5B exposes frozen pinned semantic readingMedia in the backend workspace. Drafts still edit sections only. Approval separately freezes approved-reading-media/v1 on reading_reviews; the existing approved-reading/v1 and sections-only hash remain unchanged. Required corrupt/missing media blocks approval. No card picker/editor or final card UI is implemented. See READING_MEDIA.md and PILOT_ACCEPTANCE.md.

## Milestone 6.5 seller handoff

Review uses the existing revision-checked draft and immutable approval domains. Explicit saves and the first approval add tenant-scoped actor audit entries; approval replay does not duplicate the approval audit. The immutable generated original, current draft revision, and approved snapshot are retained. Migration 0030 adds an append-only archive of persisted draft bodies, enforced by database triggers. Existing current drafts are retained at migration time; unavailable earlier bodies are not reconstructed. Saved revisions carry actor audit events.

Purchased options and canonical tarot names/orientations are visible alongside the reading. Images have an honest unavailable fallback. The media contract has no card-to-section interpretation relationship, so the interface does not infer one; interpretations remain in the reading sections.

Approved PDF readings expose explicit Prepare PDF, preview, and download. Preparation calls the existing admission service and executes only its exact returned document work ID, with existing fencing, snapshots, renderer and immutable storage. GET/page refresh does not render, enqueue or run a queue cycle. Missing storage is actionable and never reported as PDF success. Preview/download reuse the authenticated private artifact route and byte-integrity validation. No delivery or AI operation is added.

Unsaved edits warn before browser unload and application-link navigation; explicit Cancel also requires confirmation. Browser Back behavior and mobile/browser visual acceptance remain unverified in this milestone. Native application databases and live providers are not acceptance targets.
