# Manual Delivery Workspace — Milestone 6.6

The authenticated `/deliveries` list contains existing generated FulfillmentUnits, never synthetic production rows. Search, status filtering, action-first/newest/oldest sorting and 25-Reading pagination operate on scoped records. Detail provides purchased information, approval/PDF readiness, private preview/download, explicit confirmation, correction and retained history. Existing operations tokens, sidebar and responsive table/card presentation are reused.

This is seller bookkeeping, not Etsy delivery evidence. Reading OS does not send a message/file or update Etsy fulfillment. Downloads, previews and page loads never confirm delivery, enqueue work or render. Seller confirmation pins one immutable PDF artifact to one Reading. Quantity and mixed-cart siblings remain independent.

## Persistent boundary

Migration 0031 adds `manual_delivery_events` with scoped Reading/artifact references, sequence, command identity/hash, owner actor, note and server timestamp. There is no mutable delivery-status row: latest CONFIRMED means manually confirmed; latest CORRECTED reopens manual delivery without erasing the previous event. Derived NOT READY / AWAITING DELIVERY / DELIVERED / NEEDS ATTENTION also reflect approval and current artifact accessibility. When a previously confirmed PDF becomes inaccessible or the Reading changes, attention is displayed alongside the retained confirmation and correction remains available.

Database triggers serialize inserts using the Store lock, validate the owner, event sequence, exact artifact/Reading/current approval relationships and correction reason, and reject updates/deletes. Application authorization comes from the authenticated session; IDs supplied by a form never select a Store. The application database role is trusted to perform authenticated domain operations; the trigger does not independently authenticate browser sessions or verify external Etsy delivery. Existing artifact storage is trusted as an immutable bounded-read port; full byte length/MIME/hash checks are reused before confirmation. Transactions revalidate current approval and immutable artifact provenance, serialize confirmation/correction and append actor audit entries atomically. Same-command replay returns the original outcome; competing different PDFs conflict. Correction does not require accessible storage.

## Readiness and operational limits

List/detail inspect existing approved snapshots and private PDF bytes through existing services, without regeneration or state writes. Storage failures are actionable; they never become delivery success. Confirmation is a historical seller assertion, and loss of PDF accessibility does not erase it. Client-side confirmation is required; conflicts require a refresh and never overwrite another seller's decision.

Exact readiness/status filtering currently checks matched generated Readings before pagination, with at most four inspections running concurrently. This favors correct missing/corrupt-PDF visibility for the initial shop. Large-shop database/storage latency and transfer must be measured before broad rollout; there is no durable readiness cache or unsupported storage HEAD shortcut. Individual PDFs retain existing byte limits and no byte buffers are retained in list data. List/detail are current projections; every mutation revalidates and is revision-protected against stale views.

Migration 0031 is prepared and tested only in isolated PGlite. Existing application and acceptance databases are not modified. Production deployment/storage/native PostgreSQL acceptance are separate gates. No browser acceptance milestone is run here.
