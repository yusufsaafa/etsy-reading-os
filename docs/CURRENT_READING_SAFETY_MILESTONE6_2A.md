# Current Reading Safety — Milestone 6.2A

## Repository and root cause

Starting branch: `codex/ui-ux-design-lock`. Starting HEAD and required ancestor:
`39a02f3e90c3a8b079b5178c86ce84784b579783`. Checkout was clean before implementation.

Inspection of `review/service.ts` established the gap before implementation:
`validatedCandidate()` checked customer revision only when no Review existed. Once
initialized, an older Review selected its pinned Generation but could pass approval
and approved-content handoff even after customer correction or a newer successful
Generation. Existing Order projections had additional freshness checks, creating
inconsistent eligibility between display and mutation. Document admission and
artifact production also trusted prior approval/frozen snapshots. Immutable history
and approval identity were incorrectly serving as evidence of current eligibility.

The existing Review, draft, approval, snapshot, production queue, immutable artifact
protocol and persisted ownership models are reused. No migrations or new workflow
modes are introduced.

## IMPLEMENTED: authoritative freshness contract

`currentReadingEligible()` in `src/modules/review/service.ts` is the shared rule.
Authorized candidates load owned Order, LineItem, FulfillmentUnit, pinned Review and
Generation, latest Generation, latest CustomerInput, pinned ProductVersion, mapping
pause state and production queue. Order projections load these facts in bounded
batches inside repeatable-read transactions.

Operational eligibility requires:

- Consistent organization/store and Order → LineItem → FulfillmentUnit identities.
- A versioned unit and the same immutable ProductVersion in Generation and unit.
  The owned retained version must be published/archived, never DRAFT; its actual
  configuration must equal the Generation snapshot.
- Latest persisted CustomerInput revision equals unit revision and Generation
  revision; retained answers equal Generation answers.
- The reviewed Generation is the latest by existing `createdAt DESC, id DESC`
  ordering, and `reviewContent()` validates SUCCEEDED status, completion, immutable
  context/hash/bindings and canonical result. A newer in-flight/failed Generation
  also supersedes older output; successful completion cannot silently rebind Review.
- No persisted unit issues/source drift, unpaid/canceled/refund hold, or existing
  ATTENTION/EXECUTING/CLAIMED/RETRY_WAIT production hold. QUEUED alone retains the
  existing authorized Review behavior.
- Existing `activationErrors()`, `inputPolicy()` and `triage()` validate the pinned
  configuration, current purchase/source evidence, mapping pause, required answers
  and quantity allocation. No current seller/style configuration is substituted.

Existing owned foreign keys, `GENERATION_HISTORY_IMMUTABLE`, immutable published
ProductVersions, Review binding/approval triggers and optimistic draft revision
constraints remain in force. Relevant migrations include `0005`, `0013`, `0014`,
`0015`, `0017`, `0020`, `0022`; no trigger is bypassed by application code.

## IMPLEMENTED: historical versus operational Review

`validatedCandidate()` separates retained identity/content validation from current
eligibility. An existing historical Review opens with `outdated: true`, including
its original customer context and saved draft or immutable approved sections.
Historical edit opening does not create a draft, alter Review, or change its
Generation. Lazy Review/draft initialization remains authorized for eligible output
only. Corrupt retained evidence still fails closed.

`saveReadingReviewDraft()` rejects outdated content with `ReviewDraftError("STALE")`
inside the Store-locked transaction, preserving prior drafts and optimistic revision
checks. `approveReadingReview()` revalidates under that same lock before committing
approval. Corrections after page load or after draft save, superseding Generations
and newly appearing holds therefore block new approval.

Committed approval replay validates and returns the original immutable approval.
Only a still-current approval can admit document work. A stale replay does not reset
production, create snapshots or rewrite approval provenance.

The Review route retains historical content, explains the hold, and removes edit
and approval controls. Order Detail retains a historical Review link. PDF preview
links remain available but held/unapproved/outdated output receives a historical
label. No regeneration promise is added.

## IMPLEMENTED: document handoff and worker safeguards

`getApprovedReadingForDocumentInTransaction()` and the approved-media handoff require
current eligibility. Existing snapshot/media creation uses these guarded functions
under Store locking. `admitDocumentProductionInTransaction()` independently acquires
Store before rechecking the handoff. `requestDocumentProduction()` now retrieves the
approved candidate within its authoritative Store-locked admission/retry transaction.
Approval and document-work uniqueness remain unchanged.

`DocumentProductionWorker.execute()` rechecks before snapshot preparation, including
retained-media retry paths. Artifact production rechecks before rendering, before
committing new PENDING evidence, and immediately before new storage effects.
COMPLETED settlement rechecks under Store, so a correction between artifact completion
and work settlement produces READING_HOLD attention rather than a current completion.

`produceDocumentArtifact()` binds eligibility to the exact frozen Review/Generation
and approved content hash. Durable PENDING intent commits before storage. The later
Store-locked transaction covers revalidation, conditional immutable write, integrity
read and AVAILABLE finalization. This closes the correction/storage TOCTOU window;
all code paths acquire Store before downstream row locks.

Existing AVAILABLE lookup and authorized download remain historical. Existing
PENDING objects that already pass full integrity checks can be recovered/finalized
without rendering or writing again, even when historical. A stale PENDING artifact
with a missing object cannot perform a new write. No snapshots/artifacts are deleted
or rebound, and storage ambiguity preserves recoverable evidence.

## IMPLEMENTED: current delivery-readiness semantics

`readingOutputStatus()` uses a single repeatable-read transaction and the current
approved handoff before checking output type, production and AVAILABLE evidence.
Stale output raises the existing safe REVIEW_UNAVAILABLE boundary with STALE kind;
it never returns deliveryReady=true merely because historical PDF bytes exist.
TEXT approval also requires current eligibility. No delivery transport, Etsy sending
or delivered status is added.

## Concurrency and limits

Review mutation, input correction, generation admission, intake hold
updates, document admission/snapshots and artifact writes coordinate through the
existing Store lock. Review draft locks, document-work claim fencing and artifact
locks follow Store. Read-only status projections use repeatable-read snapshots;
page rendering is informational and does not authorize later mutations.

AI completion independently locks its AIRequest and updates Generation atomically
through the gateway finalizer; it does not take Store. This existing ordering is
preserved. A PROCESSING candidate cannot authorize Review actions. Once SUCCEEDED,
the SQL trigger makes that Generation immutable. Newer Generation admission uses
Store, and every operational boundary checks latest Generation identity and current
customer revision. Completion of a request after a correction retains historical
canonical output but cannot initialize or promote it into eligible Review work.

A correction committed first rejects approval/new output. An approval or guarded
storage write admitted first may finish; a subsequent correction immediately makes
that evidence historical for current assessments. Rendering has no persisted or
external storage effects and can finish speculatively if a correction arrives after
its preflight; the PENDING/write rechecks reject further new work.

Holding Store across bounded storage operations is a deliberate correctness tradeoff:
other Store mutations wait for the storage port. Production adapter timeout/load
behavior requires acceptance. If write succeeds but transaction/response fails,
previously committed PENDING metadata enables integrity-based recovery. No other
service callback may perform a nested database mutation while this lock is held.

Existing one-Review-per-unit identity is not migrated: a newer Generation does not
silently get a replacement Review. An explicit future review lifecycle is needed
to review superseding output where a historical Review already exists. Existing
reviewContent compatibility limitations for default seller/style bindings are not
expanded in this milestone.

## TESTED: evidence

Completed at this point: `pnpm test` passed 1,008 tests in 95 files;
`pnpm typecheck` and `NEXT_TELEMETRY_DISABLED=1 pnpm build` passed.
`pnpm test:db` passed 562 tests across 28 files using isolated PGlite databases.
`git diff --check` passed. Node 22.23.1 was used for all validation commands.
The late-correction/completion regression was subsequently strengthened with explicit
Review rejection assertions; `pnpm test:db tests/generation.db.test.ts -t "late customer correction"`
passed the strengthened test (1 passed, 88 skipped). No production code changed after
the successful complete database sweep.
The initial database run identified two stale fixture assumptions in reading-media
coverage; both corrected cases passed the focused 15-test media rerun. The focused
Review/artifact regression run passed 128 tests before the final two additional
rendering/operator cases. These are isolated test results, not real-store acceptance.

Focused coverage in `tests/review.test.ts`, `tests/generation.db.test.ts`,
`tests/document-artifact.db.test.ts`, `tests/review-approval-page.test.ts`,
`tests/review-draft-actions.test.ts`, `tests/reading-media.db.test.ts`, and
`tests/order-operations.test.ts` covers:
current approval, before/after initialization and draft corrections, ordered approval
races, superseding output, historical viewing, stale draft/approval rejection,
immutable/idempotent replay, historic AVAILABLE downloads, stale current readiness,
all document admission boundaries, worker holds, PENDING recovery with/without stored
objects, guarded storage/correction ordering, holds, tenant/operator policy regressions,
independent mixed-cart/quantity units and unchanged ProductVersion pins.

Database suites apply actual migrations to fresh disposable PGlite databases. Fake
providers, synthetic customer data, in-memory storage and temporary local storage
are test-only. Existing provider/Review/document regressions run in full.

## NOT VERIFIED

Native PostgreSQL lock scheduling/deadlocks under independent connections, production
storage latency/conditional-write behavior, authenticated real-store browser acceptance,
real AI/Etsy calls and external delivery are not verified. PGlite tests exercise
transaction ordering and persisted guards but are not production concurrency acceptance.
No development/production DB, live Etsy/AI or external object storage is used.

## Required scenario coverage

| Requested scenarios | Repository evidence |
| --- | --- |
| A, J, K, W, X | Existing canonical/draft approval lifecycle, concurrent identical approval, immutable SQL approval, document admission replay tests in generation/artifact suites |
| B | Correction before initialization rejects lazy Review/draft creation |
| C, D, G, H, I | Correction after initialization/after save preserves original content and draft evidence while rejecting STALE mutations; historical edit opening creates no draft |
| E | Concurrent correction/approval in both submission orders; PGlite transaction ordering only |
| F | Newer PROCESSING and later SUCCEEDED fixtures supersede old Review; Review pin and semantic media remain historical |
| L, M | Historical AVAILABLE download/hash verification and rejection of current readingOutputStatus; historical Order PDF labels |
| N, O | Stale snapshot/media creation, explicit requests, transaction admission, worker preflight and producer reject before new artifact/storage effects |
| P | Lost-response PENDING object can finalize historically; missing-object PENDING cannot write after correction; recovery/claim-fencing regressions |
| Q | Canceled/refunded/unpaid/source/allocation holds reject Review advancement; existing canceled worker regression |
| R, S | Cross-tenant/sibling/forged scope regressions; operator can edit/approve but cannot explicitly request/create owner-only documents; historical downloads remain authorized |
| T, U, V | Correct one of three mixed-cart/quantity units, reject its approval, approve unaffected sibling and assert retained ProductVersion pins |
| Y | Entire document-artifact suite, media semantics, frozen snapshots, PDF/integrity/storage regressions |

Additional race coverage corrects inputs during speculative rendering and schedules
a correction behind guarded storage I/O. Neither case promotes historical output
into current readiness. Production PostgreSQL scheduling remains NOT VERIFIED.


## Changed files

- `src/app/(operations)/orders/[id]/page.tsx`
- `src/app/(operations)/orders/[id]/readings/[readingId]/review/page.tsx`
- `src/components/review-reading.tsx`
- `src/components/review/actions.ts`
- `src/modules/documents/artifact-service.ts`
- `src/modules/orders/detail.ts`
- `src/modules/orders/operations.ts`
- `src/modules/production/documents.ts`
- `src/modules/review/draft-contract.ts`
- `src/modules/review/service.ts`
- `tests/document-artifact.db.test.ts`
- `tests/generation.db.test.ts`
- `tests/order-operations.test.ts`
- `tests/reading-media.db.test.ts`
- `tests/review-approval-page.test.ts`
- `tests/review-draft-actions.test.ts`
- `tests/review.test.ts`
- `docs/CURRENT_READING_SAFETY_MILESTONE6_2A.md`
