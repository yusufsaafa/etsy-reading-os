# Review Workspace — Part 1

Review is entered through Orders, with no primary navigation change. Sellers can read a prepared Reading and the customer details used for it. Editing, approval, regeneration, documents and delivery are not implemented.

## Durable foundation

One reading_reviews row per owned Reading pins the exact successful Generation. PENDING is the only review lifecycle state in this foundation: it means seller review is still pending, distinct from successful preparation. Future reviewed content/state requires explicit later design/migrations; it will never overwrite generated evidence. We deliberately do not invent document or approval states in Part 1.

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

Real Gemini calls: 0. Parts 2–4 remain out of scope.
