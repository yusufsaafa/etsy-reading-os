# Review Workspace — Part 4 final report

REVIEW WORKSPACE COMPLETE (Parts 1–4). Branch: codex/ui-ux-design-lock. Starting commit: 4f4fda4802cd68a6128ac44e08d58043d1ccbdae. Ending commit is reported in the task response, since the report cannot contain its own commit SHA.

## Lifecycle audit and concrete changes

Generation → lazy owned review admission → optional durable draft → immutable approval → approved Reading → document-input boundary. Original evidence, review pin, saved draft and approved artifact remain distinct. Existing Store locks, expected revisions, transactional approval and SQL guards compose correctly. No new editing/approval feature, migration, production redesign or provider operation.

Concrete issues fixed:

1. Orders availability could succeed for malformed saved PENDING drafts although the review route rejected them. Status now validates effective saved content and fails closed.
2. Eligible Orders readings previously received two complete eligibility/status traversals. List/detail now resolve one status per Reading in one repeatable-read transaction and derive both availability and Approved from it.
3. Approved application validation now rejects nonfinite approval time, invalid draft provenance numbers, and canonical-only provenance whose body differs from exact pinned canonical evidence—even if a forged content hash matches.

## Approved-reading handoff

`getApprovedReadingForDocument(db, scope, orderId, readingId)` returns the strict versioned `ApprovedReadingForDocument` value. It is a local repeatable-read server read, with persisted membership/owned relationships and existing operational holds. Only a complete, structurally valid APPROVED artifact with matching semantic hash and valid pinned successful evidence can pass. Pending/draft-only/missing/corrupt/foreign state fails closed without repair.

Fields: contractVersion approved-reading/v1; organizationId/storeId/readingId; order id/reference/customer display name; purchased product name; readingNumber/quantity; exact approved ordered section IDs/titles/bodies; contentHash; approvedAt ISO string; reviewId/pinned generationId provenance. The DTO is detached, deeply frozen at runtime and deeply readonly in TypeScript. No mutable Date, draft internals, editing API, raw Generation result, accounting, provider/model, prompt, style intelligence or queue data is returned. Display metadata comes from owned purchased facts; the future document layer must snapshot metadata/design when rendering.

The section body source is exclusively immutable approved_content. Later Generation, draft or style content is never substituted. A latest Generation status check preserves existing operational problem precedence without using its body. Hash semantics are unchanged: SHA-256 over UTF-8 stableJson of ordered section IDs/titles/exact bodies; timestamps and provenance excluded. An incompatible meaning requires explicit contract versioning.

## UX, security and invariants

Orders uses Ready for review / Review reading before approval and Approved / View reading afterward. Existing Preparing, information and Problem precedence remains. The same review route selects validated saved/canonical content for PENDING and approved content for APPROVED; edit mode is blocked after approval. Wrong pairs and unavailable evidence fail closed. Seller errors never reflect raw infrastructure exception strings. Pending controls, native labelled textareas, announced feedback, confirmation focus/Cancel and text statuses remain intact.

Security coverage retains cross-org and sibling Store read/save/approval guards and adds handoff isolation. Client intent cannot select Generation, approved content, hash or provenance. Customer and seller text stays escaped. New tests cover handoff corruption and saved-draft availability; existing original/context hash, structure, ownership and approval-completeness tests remain active.

0013–0015 audit: one review per Reading; exact owned immutable Generation pin; one draft per review; canonical initialization; strict fixed section structure; revision progression; complete atomic PENDING→APPROVED; immutable approved content/hash/actor; no post-approval draft mutation. NO MIGRATION REQUIRED. Existing from-scratch/repeat-no-op and historical-data preservation suites run unchanged.

Queries for a single Reading are identity/Store-scoped and bounded, with latest Generation LIMIT 1; no historical Generation/draft/source library is loaded. The duplicate Orders traversal is removed. Pre-existing whole-Store workspace loading and per-reading status queries remain scaling limitations; no pagination/batched projection redesign is claimed.

## Native viewport acceptance

Actual ReviewReading and ReviewDraftForm components were rendered with repository CSS and synthetic text in the native in-app browser at 390×844 and 1440×900. Both view and edit layouts had document scrollWidth equal to viewport width. At 390px the labelled textarea was 350px wide; at desktop it stayed in the bounded reading column. Long name/label/question, 500-character unbroken customer string, URL/long reading spans, paragraphs, Unicode/emoji, quotes, HTML-like text and quantity label were exercised. Unicode remained intact; HTML-like text created no script element. Temporary viewport override/tab/server were cleaned up.

This is native component viewport QA, not a hydrated application/auth/save/approval browser end-to-end run, physical-device QA or screen-reader certification. Durable end-to-end acceptance uses real application services with synthetic local PostgreSQL-engine fixtures plus route/action/render tests. Existing cancel/no-save, stale editor/approval, post-approval and mixed-cart/quantity tests remain active.

## Deferred Document/PDF boundary

Approved Reading + document configuration/template → document snapshot → shared deterministic paginated preview/render → PDF artifact. Review owns edits and approval; Documents will own templates, saved controlled seller designs, logo/brand/colors/font choices, cover/footer/display options, product→design assignment and approved-Reading preview. This is not a Canva-like freeform editor. Preview/PDF must share one deterministic layout model. None is implemented here. Delivery, Telegram, billing, regeneration/reopening and approval history remain deferred.

## Files

- docs/REVIEW_WORKSPACE.md
- docs/REVIEW_WORKSPACE_PART4_REPORT.md
- src/modules/review/approved-reading.ts
- src/modules/review/service.ts
- src/app/(operations)/orders/page.tsx
- src/app/(operations)/orders/[id]/page.tsx
- tests/approved-reading.test.ts
- tests/generation.db.test.ts
- tests/review-orders.test.ts
- tests/review.test.ts

## Validation

| Check | Result |
| --- | --- |
| pnpm typecheck | PASS (supported Node 22.23.1; tooling noise restored) |
| pnpm test | 163 tests / 26 files PASS |
| pnpm test:db | 277 tests / 11 files PASS |
| Total | 440 tests / 37 files PASS |
| pnpm build | PASS, production webpack build |
| Existing migration suite | PASS: from-scratch replay, repeat no-op, historical preservation |
| git diff --check | PASS |

Four new unit tests and five new DB tests supplement updated Orders projection coverage. Full DB run completed in 204.92 seconds. NO MIGRATION REQUIRED. Final repository status is reported after commit. Build-generated Next TypeScript noise is restored and excluded from the commit.

 Added meaningful coverage: canonical and edited full lifecycle/handoff, exact artifact/provenance/hash, pending/draft-only rejection, immutable detached DTO, forbidden DTO fields/bounds, foreign/sibling Store handoff, malformed draft status, malformed approval/hash rejection, later Generation/mutable draft independence, impossible approval provenance, safe error copy and near-bound Unicode/plain-text rendering.

Original Generation and approved Reading remain immutable. Document/PDF Engine NOT implemented. Real Gemini calls: 0. No push or deployment. General production authentication/access/retention/scaling gates remain separate from this completed Review milestone.
