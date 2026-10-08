# Real Etsy order pilot — Part 2B-1: private candidate review

Date: 2026-10-09 (Europe/Istanbul). Starting HEAD `8361a3e790b18ff82351efc19994d45fdfa3e53b`, branch `codex/ui-ux-design-lock`, existing local Mac checkout. Exact branch/HEAD/history preflight passed. Only the inspected existing Next.js-generated changes were present and remain excluded.

## Private owner procedure

1. Sign in through the existing application authentication as the Store owner. Open `/etsy/historical-review` on the current local development origin. No temporary tunnel URL is embedded. The route derives Store scope from the authenticated session, not browser tenant claims.
2. Review the newest paid receipts in the bounded 90-day/max-three window. The private page displays purchased listing title, purchase date, purchased selection labels, quantity, receipt/transaction references, exact matching active Product version, its approved configuration, historical requirement and HOLD categories. Buyer answers, names, emails, addresses and purchaser account identifiers are not rendered. Labels are display evidence only.
3. Choose **Select this purchase for review** for ONE supported historical transaction. The server fetches that explicit owned receipt again, resolves the exact complete property/value set and checks source status, input compatibility, quantity-one policy, activation fence and operational pause. Wrong transaction/version or any other HOLD rejects selection. No Product or domain ingestion is performed.
4. On the confirmation screen review the pinned purchase references and immutable Product configuration. Check the explicit review statement and click **Confirm review only**. This re-fetches and checks the same source fingerprint and current exact Product resolution. A mismatch invalidates the review; the page asks for fresh review. Confirmation is not historical adoption permission.
5. For a later separately authorized adoption operation, identify the confirmed private review record. The trusted executor must call `revalidateConfirmedReview` immediately before approval and use the returned exact Store/shop/receipt/transaction/configuration/version/fingerprint pin, then compare the final approval source against every returned identity and fingerprint before running the existing historical adoption command and all its normal gates. A second fetch must not silently replace the reviewed fingerprint. The helper fails on unconfirmed/invalidated evidence and never approves or ingests. No adoption UI/action has been enabled here. A separate explicit live authorization and authenticated owner execution are still required.

This creates a **new owner-reviewed candidate lock**, not proof that a purchase is identical to the unretained Part 1/2A candidate. No candidate was selected or confirmed on behalf of the real owner during implementation.

## Durable evidence and safeguards

The new bounded `etsy_candidate_reviews` table stores only owner/tenant, shop, receipt, transaction, listing, canonical exact selection key, owned ProductVersion, SHA-256 source fingerprint and review/confirmation/invalidation timestamps. No raw payload, buyer answer, buyer identity or media URL is stored. Existing fingerprint semantics exclude transport observation time only; changed purchased/status/context evidence requires renewed review. Hashes and private purchase references are not printed in reports/logs.

The existing source normalizer, exact resolver, owner authorization, encrypted grant/refresh and bounded receipt reader are reused. A small shared owned-grant helper enables sample discovery without a second client. Confirmation is a separate server action and requires explicit checked intent; normal page views/discovery never create review records. Review evidence is never consulted by existing eligibility resolution as adoption authority. There is no adoption/ingestion/provider call in the review module or actions.

Store locking serializes review/confirmation replay. Tenant/version composite foreign keys and evidence uniqueness supplement application authorization. SQL guards prevent identity/fingerprint rebinding, deletion, confirmation timestamp rewriting and invalidation reversal; a review may be invalidated after confirmation. Same evidence selection/repeated confirmation is idempotent. Invalidated evidence records remain retained and cannot regain authority. A newly changed source/version has a distinct evidence pin and requires a new review.

## Migration and validation

Migration `0024_giant_giant_girl.sql` adds only the review table and evidence guards. Local native history was verified against repository SQL hashes/timestamps before applying it: **24 → 25**. A repeated migration was a no-op; sanitized in-memory hashing verified every previously existing public table's rows unchanged. No Store/Product/OAuth data was reset. Drizzle schema generation reports no drift. Temporary migration verification tooling was removed.

Focused validation: 75 unit/render/source tests in four files; 34 isolated PGlite DB tests and 38 native PostgreSQL tests (34 shared cases plus four native concurrency/engine cases). These overlap and are not distinct totals. Typecheck, production build and `git diff --check` passed. Tests cover exact identity/fingerprint, owner/operator and cross-tenant denial, wrong transaction/version, changed source and malformed evidence invalidation, confirmed-review precheck, replay, no adoption/domain/production writes, private render projection and explicit confirmation intent. Existing controlled intake/cardinality/replay tests remain in the regression run. Native tests use disposable local databases, not the real MRH Store.

## Bounded real read evidence

The existing read-only acceptance tool performed one list GET and three detail GETs, all HTTP 200/JSON. The encrypted grant refreshed normally; no reconnect, tunnel or callback/configuration change was required. Three paid completed receipts/three quantity-one lines retained six purchase selections and three text inputs. No customer values or private identifiers were printed or persisted.

The current distribution differs from the earlier report: **two** exact current active matches with compatible input mappings, of which **one** is historical and **one** normally applicable; the third has no exact active mapping. This is fresh structural evidence only, not historical candidate continuity. Existing dry-run reporting returns one eligible/two held and one historical adoption requirement. No candidate selection, confirmation, adoption or ingestion occurred. Domain state fingerprints remained unchanged inside the read-only assessment. OAuth refresh is credential lifecycle only, not an Etsy commerce mutation.

Authenticated live owner review/browser interaction is **NOT VERIFIED**. The owner must perform the private selection/confirmation steps above. No Safari automation was restarted. Tests/render evidence do not substitute for that manual authenticated check.

## Remaining boundaries

ETSY-E2E-01, ETSY-CARDINALITY-01 and ETSY-INPUTS-01 remain OPEN. This milestone does not perform real adoption, Order/line/Reading creation, generation, PDF, messages or delivery. Normal post-activation purchases are displayed but cannot enter this historical-only review action. Future live execution must independently ensure single-line authorization does not expand to held sibling lines through the existing receipt-atomic ingestion engine. No push/deployment occurred.
