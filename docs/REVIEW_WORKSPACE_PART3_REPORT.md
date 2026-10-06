# Review Workspace — Part 3 report

Branch: codex/ui-ux-design-lock. Starting commit: e73b25b3842b0af18e23d30e435ac841139e4259. Ending commit is reported in the task response; this artifact is committed with the implementation.

## Implementation

- Approved-reading model: additive nullable approved_content, approved_draft_revision, approved_content_hash, approved_at and approved_by_user_id on the existing owned reading_reviews row. Review identity, Reading identity and immutable Generation pin provide provenance. One immutable approval per review, without a separate history/audit subsystem.
- Migration: 0015_stale_omega_sentinel; no destructive change, historical backfill or canonical mutation. Existing PENDING reviews and drafts remain valid.
- Source selection: no draft uses exact validated pinned canonical sections; any existing saved draft uses its exact validated revision, including unmodified revision 0. Approval accepts no browser content. Sections, titles, order and bodies are frozen.
- Lifecycle: PENDING → APPROVED once, atomically with the approved artifact. No reopening or unapproval.
- Eligibility: authenticated membership, owned Order/Line/Reading/review, exact successful pinned evidence, valid context/hash/section contract and existing production/payment/refund/source holds. Corruption and mismatched relationships fail closed.
- Hash: SHA-256 of stable JSON over ordered section IDs, titles and exact body text. No volatile timestamp in the semantic hash. Approved reads verify this hash and the bounded content contract.
- Concurrency: Store-first locks serialize draft initialization/save/approval. Expected loaded revision (or explicit no-draft token) prevents stale approval. Approval races create one immutable artifact; repeated consistent approval returns it. Server always derives content.
- SQL invariants: composite owned review/Reading/Generation foreign keys and existing one-review uniqueness remain; CHECKs bind PENDING to absent approval fields and APPROVED to complete content/hash/time; trigger preserves identity/pin and permits only one-way approval from exact current durable content/revision. Approved rows cannot update/delete. Draft mutations lock the owned review and require PENDING, alongside existing structure/revision guards. No partial approval state is possible through the transactional update.
- UI: same /orders/[id]/readings/[readingId]/review route. Read mode offers Edit reading and Approve reading. Inline confirmation explains finality, with semantic form/buttons, focus movement/return, Cancel, disabled pending controls and announced feedback. Active editing has no approval action. Approved content renders from its artifact with Approved status and a restrained next-step message.
- Orders: individual Approved / View reading; all-approved order aggregate is Approved. Approved readings leave the Ready count. No order-wide approval action or delivery state.
- Post-approval: draft retained unchanged; draft initialization and normal saves blocked. Original Generation/context/hash/result, review pin, customer revision, product/style and accounting records remain unchanged.
- Mixed carts and quantities: each Reading remains independently reviewed, drafted and approved. Approving one leaves its siblings pending.
- Security: scope derived from current authentication; server reloads owned relationships. Approval action rejects client content, Store/review/Generation/hash fields. Cross-organization and sibling Store access fail closed. Revision intent confers no ownership.
- Corrupt state: safe unavailable/not-found workspace and seller-safe action feedback; invalid approved hashes/content never display or gain eligibility.
- Mobile/accessibility: existing wrapped 72ch document layout, wrapping action rows, native controls, text statuses, escaped bodies, keyboard focus and live error/loading feedback. Automated markup/layout-structure checks passed; native viewport and screen-reader acceptance are not claimed.

## Files changed

- docs/REVIEW_WORKSPACE.md
- docs/REVIEW_WORKSPACE_PART3_REPORT.md
- drizzle/0015_stale_omega_sentinel.sql
- drizzle/meta/0015_snapshot.json
- drizzle/meta/_journal.json
- src/db/schema.ts
- src/modules/review/service.ts
- src/app/(operations)/orders/page.tsx
- src/app/(operations)/orders/[id]/page.tsx
- src/app/(operations)/orders/[id]/readings/[readingId]/review/page.tsx
- src/app/globals.css
- src/components/generation/reading-preparation.tsx
- src/components/review-reading.tsx
- src/components/review/actions.ts
- src/components/review/approval-form.tsx
- tests/generation.db.test.ts
- tests/review-draft-actions.test.ts
- tests/review-orders.test.ts
- tests/review-approval.test.ts
- tests/review-approval-page.test.ts

## Coverage and validation

New coverage includes canonical-only and saved/unmodified draft approval, exact ordered content/provenance/hash, unchanged original/pin/draft/accounting, one-way SQL guards, idempotent/concurrent approval, stale revisions, save-versus-approve races, post-approval locks, malformed/forged client requests, tenant/sibling Store isolation, atomic failure, independent quantity/mixed-cart approvals, approved snapshot display despite unrelated draft corruption, corrupt snapshot rejection, escaped HTML, read/edit/approved controls, Orders labels and deterministic hash changes. Existing production/generation/style/pinning/draft suites remain active. Fixtures are synthetic, using only fake generation providers where initial evidence is needed; approval itself performs no provider operation.

| Check | Result |
| --- | --- |
| pnpm typecheck | PASS on supported Node 22.23.1, after restoring tooling noise |
| pnpm test | 159 tests / 25 files PASS |
| pnpm test:db | 272 tests / 11 files PASS |
| Total | 431 tests / 36 files PASS |
| pnpm build | PASS, production webpack build |
| Migration replay from scratch / repeat application | PASS, existing tracked migration runner coverage and focused replay check |
| Drizzle schema/snapshot consistency | No schema drift |
| git diff --check | PASS |

Final full DB run completed in 188.09 seconds. Six new DB tests and ten new unit tests supplement extended mixed-cart/quantity and action/Orders coverage. Focused approval plus migration replay also passed. No production database or real customer fixtures were used.

## Preserved boundaries

Original canonical Generation and review Generation pin remain immutable. No PDF/document engine, delivery, regeneration, reopening, Part 4, new primary navigation, provider change or style change is implemented. Real Gemini calls: 0. No push or deployment. Build-generated next-env.d.ts / tsconfig.json noise is restored, not committed.

Approval records the authenticated actor using the existing stable app_users identity and nullable additive foreign key. No actor is fabricated for historical PENDING reviews; approved actor identity is immutable and is not displayed to sellers.
