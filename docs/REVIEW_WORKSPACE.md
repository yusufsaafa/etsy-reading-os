# Review Workspace — Parts 1–2

Review is entered through Orders, with no primary navigation change. Sellers can read a prepared Reading and the customer details used for it. Part 2 adds section-body editing and explicit durable draft saving. Approval, regeneration, documents and delivery are not implemented.

## Durable foundation

One reading_reviews row per owned Reading pins the exact successful Generation. PENDING is the only review lifecycle state in this foundation: it means seller review is still pending, distinct from successful preparation. Part 2 seller draft content lives separately from this immutable base; later approval requires explicit design/migrations. We deliberately do not invent document or approval states in Part 1.

Admission is lazy on first workspace entry under the Store row lock, after persisted membership and Store/Order/Line/Reading ownership checks. Concurrent entries create one base. Orders eligibility reads never create reviews, and Review links disable prefetch. No historical backfill. Composite foreign keys bind the same organization, Store, Reading and Generation; a unique constraint protects one base, and a database trigger rejects non-successful evidence and updates/deletes of the base. Original Generation/context/result and AI accounting remain untouched.

## Eligibility and stability

A current successful Generation with completed timestamp and canonical result is required. Hash, context version, product/style/seller/customer revision bindings, product input definitions, bounded answers and exact product section contract are validated on read. Forged, missing, corrupt, failed or processing evidence fails closed. Existing reading holds, order payment/cancellation/refund holds and source changes also block entry. Production ATTENTION, EXECUTING, CLAIMED and RETRY_WAIT block entry; an undispatched QUEUED intent alone cannot override a successful validated seller-prepared reading. This is important because the existing owner preparation path can finish while its queue intent remains QUEUED. No orchestration behavior was changed.

Before initial admission, successful preparation must match the current customer revision. After a pin exists, review continues to use its original evidence and frozen customer details, even if a later successful Generation exists. A newer processing/failed attempt or production problem blocks display without changing the pin. No floating latest-result replacement, regeneration action or automatic provider call.

## Seller experience

Route: /orders/[id]/readings/[readingId]/review. Current scope is derived server-side; the URL accepts only Order/Reading identities, never Store or Generation identities. Unavailable/corrupt/foreign readings map to the existing safe not-found experience. Orders displays Ready for review and Review reading only after domain eligibility, replacing inline prepared-content display.

The workspace uses existing Heading, Badge, button/back-link and operational shell patterns. Customer name, purchased product title and order reference identify the task. Quantity greater than one adds Reading n of quantity; mixed-cart lines and quantity units are independently pinned. Customer details come from the pinned GenerationContext, labelled by its retained ProductVersion input definitions; missing optional details say Not provided. The reading renders validated sections in deterministic product order without IDs or raw metadata. Text is escaped, intended line/paragraph breaks preserved, and no editing/approval controls exist.

The document column is limited to 72ch, with long strings wrapping anywhere. Customer details use a grid whose minimum fits the container; existing responsive headers stack on phones. Semantic headings, labelled sections/article, text status and keyboard links reuse accessible primitives. SSR/structure tests verify semantics and responsive constraints; native browser viewport QA is not claimed.

## Migration and validation

0013_flat_prodigy adds reading_reviews, owned composite generation identity and immutable review-base guard. Historical rows are preserved; no review records fabricated. Existing migration replay/repeat-no-op and production historical-data preservation suites remain active. New domain/DB tests cover pinning, concurrency, original immutability, later evidence, tenant and sibling Store isolation, forged relationships, missing/failed/processing/problem/corrupt data, mixed carts and quantities. Render tests cover frozen labels, optional/long answers, canonical order, escaped text, metadata exclusion, Orders links, semantic landmarks and responsive structure.

Real Gemini calls: 0. Parts 3–4 remain deferred.

## Part 2 — seller-owned durable drafts

reading_review_drafts is a separate table with one row per owned immutable reading_review, JSON sections, integer revision and updatedAt. It has an owned composite foreign key to the review. The review's pinned Generation remains the sole origin; neither review pin/state nor original generated reading/context, customer inputs, style or AI accounting is changed by editing. Review remains PENDING: no IN_REVIEW or approval state is introduced. Orders keeps Ready for review / Review reading.

Read mode defaults to saved draft content when a draft exists, otherwise original evidence. Edit reading opens the same route with validated edit=1. First edit initializes revision 0 from the exact pin under the Store lock; concurrent entry creates one row. Subsequent entry never resets saved content. Merely opening edit mode and canceling may leave an unmodified revision-0 row; unsaved body changes are never written by Cancel. No autosave.

The explicit Save changes server action derives scope from authenticated membership, rechecks Order/Reading ownership and current Part 1 eligibility, loads the exact review/draft and validates the entire submitted section set against pinned evidence. It accepts body text only: section count, identity, order and titles remain fixed. Strict Zod rejects unknown fields and malformed bodies. Each body is nonblank and at most 40,000 UTF-16 code units, at most 20 sections, serialized aggregate at most 512,000 UTF-8 bytes; action prechecks count, field types and aggregate before construction. Native Next server-action request size limits remain in place. Text whitespace/newlines are preserved without HTML interpretation.

Saving uses the loaded expected revision, Store/row locks and a revision-conditioned update. Each successful save increments once. Another save first causes a seller-safe conflict and cannot overwrite it. The form retains controlled typed text on errors; a successful save redirects to readable mode with restrained Changes saved feedback. Cancel confirms discard when dirty; a native beforeunload warning covers browser reload/close. The edit surface omits the separate Order back link to keep Cancel the clear exit. No fragile global interception of all SPA navigation is implemented; browser-history navigation is not universally guarded.

Effective modification is computed from validated saved content versus the normalized pinned canonical sections using stable JSON comparison. There is no drifting modified flag: restoring exact original bodies yields modified=false. Every read validates saved structure before displaying it. SQL guards prevent draft identity reassignment/deletion/reset, require revision progression, and bind section identities/titles/order to the pinned reading. Initial SQL content must equal pinned evidence. Historical Part 1 reviews remain valid without drafts; migration 0014_sad_orphan is additive and does no backfill.

Each mixed-cart or quantity Reading has an independent draft/revision. Reads and writes are Store-scoped; no client Store/review/Generation identity grants ownership. Customer context remains read-only. Seller text uses normal escaped rendering in view mode and native labelled textareas in edit mode, with responsive widths/wrapping, existing touch-target buttons, keyboard Cancel/Save and announced errors/loading. Mobile coverage is rendered structure/CSS, not a claimed live viewport run.

Approval/final content, PDFs, delivery, regeneration, rewriting, proofreading and rich editing remain explicitly deferred. No provider call, prompt/style change or production redesign accompanies saving.
