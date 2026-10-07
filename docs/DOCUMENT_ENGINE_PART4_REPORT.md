# Document Engine Part 4 report

Recovered and completed from `cdc509b1c709b5e565d34590c7d44ec07087f238` on `codex/ui-ux-design-lock`, 2026-10-07. Existing uncommitted implementation was inspected and preserved; no reset, checkout, stash or clean was used. The completion commit is the commit containing this report. No PDF renderer, pagination, Generation semantics or frontend was replaced.

## Domain and contracts

Documents now owns immutable `document_artifacts` tied to exact Organization/Store/Order/Reading/document snapshot/media snapshot evidence. Strict detached `document-artifact/v1` includes IDs, rendererVersion, layoutHash/resourceHash/PDF SHA-256, byteLength/pageCount, controlled application/pdf, deterministic private objectKey and PENDING/AVAILABLE timestamps. No PDF bytes, current configuration, AI/provider/accounting, customer answers, credentials or URLs are stored. `available-document-artifact/v1` removes objectKey; owned retrieval returns detached copyBytes. No redundant hash is introduced.

The actual existing `ValidatedDocumentPdf` from reading-pdf/1 is consumed. Exact PDF SHA/length/page count/layout/resource/renderer evidence is compared and persisted. AVAILABLE reuse does not invoke rendering or asset reads. Existing production-font-metrics/1, document-layout/v1 and verified resources remain authoritative; full font embedding/glyph positioning/rotation remain Part 3B-2 behavior.

## Schema, identity and immutability

Additive migration `0020_clean_franklin_storm.sql` adds document_artifacts and downstream document_production, plus generated journal/snapshot. Two tables raise the schema to 40 tables. Ownership/source FKs and SQL provenance guards bind exact Reading/order/document/media and pinned PDF Product configuration. SHA/size/page/MIME/lifecycle checks and owned lookup/due indexes are enforced. Artifact evidence cannot UPDATE or DELETE; only PENDING → AVAILABLE finalization is allowed. Completed work, source identity and previously pinned media/artifact references are immutable. Supplementary claim/failure checks and SQL transition guards are retained in the migration. No destructive backfill or historical mutation.

Unique artifact intent is organization/Store/Reading/document snapshot/media snapshot/rendererVersion. Media already binds its exact document source. Layout/resource/PDF hashes are invariant evidence for that intent: a mismatch fails as ARTIFACT_RENDER_CONFLICT rather than creating another successful output. Concurrent insertion uses DB uniqueness, not check-then-insert alone. Key format is `private/documents/v1/{organization}/{store}/{reading}/{mediaSnapshot}/{renderer-with-dash}/{pdfSha}.pdf`; server-owned IDs/version/digest only, checked by SQL. No key-based authorization.

## Storage and recovery protocol

The original generic put/get port cannot prove write-once creation or bounded reads. Narrow provider-neutral ImmutableArtifactStorage adds conditional putImmutable and read(maxBytes) in the existing storage architecture. Production adapters must use atomic conditional creation, idempotent identical evidence and hard conflict for different bytes/MIME; no HEAD-then-overwriting-PUT. Domain has no AWS/CloudFront SDK coupling. Test memory adapter only; no real storage adapter/credentials or real acceptance.

Protocol: validated PDF → durable PENDING evidence → immutable write → bounded full read checking object identity/application/pdf/length/SHA → AVAILABLE commit. No DB transaction spans render/storage I/O. An object never precedes its durable intent. Lost responses or crash after write are adopted by pending-object verification without rerender/second write. Missing pending objects may rerender exact frozen input with evidence equality; corrupt/conflicting objects fail without overwrite. Failed DB finalization leaves recoverable pending evidence and object. Availability is the owned service's verified external outcome; SQL cannot itself prove storage I/O. Real adapter immutability/retention remains required.

Store → work/artifact is the application locking order. Claims persist UUID token and 15-minute expiry. Current token fences settlement; expired late workers may perform identical immutable effects but cannot settle a replacement claim. Artifact finalization is idempotent. Native separate-connection concurrency/deadlock and real storage contention are not proven by PGlite and remain acceptance debt.

## Workflow, failures and regeneration

ASSISTED PDF approval atomically admits downstream work. MANUAL uses explicit owner requestDocumentProduction. TEXT bypasses document design/PDF/storage and preserves Approved behavior. Existing productionRuntime(db, documentPorts).runProductionTick invokes the bounded document stage after Generation under existing tick coordination. Missing injected ports explicitly yield STORAGE_NOT_CONFIGURED; no fake production adapter or recurring worker is installed. Low-level runCycle remains Generation-only.

Infrastructure lifecycle is WAITING → PROCESSING → COMPLETED / RETRY_WAIT / ATTENTION. Approved eligibility is rechecked under Store lock before input pinning; once pinned, the media snapshot is retained across retries. Safe storage UNAVAILABLE/MISSING uses existing 30/120-second durable backoff, up to three attempts per explicit recovery window. Expired document claims are unpaid/idempotent recovery, not an AI retry. Conflicts/integrity/limit, invalid snapshot/font/resource/PDF, missing immutable artwork, setup/holds and unknown errors need attention. Owner recovery resets the bounded retry window while preserving source/artifact identity. Audits retain admission/retry/attention/recovery/completion actions without private content; work retains current stage/failure/attempt/times. Generation/accounting is untouched.

PDF output projection becomes **Ready to deliver**, deliveryReady=true and artifactId only when downstream work is COMPLETED and the artifact AVAILABLE. TEXT returns Approved, deliveryReady=true, artifactId=null. Holds still block readiness. Neither download nor readiness sends or marks DELIVERED. Existing seller UI labels are unchanged; final UI comes later.

Exact same source/version/output converges to the same artifact. New design/media snapshot produces a new artifact; historical AVAILABLE evidence is never replaced. Explicit regenerateDocumentArtifact resolves current approved presentation intent, retaining all history and leaving completed approval work's selected artifact unchanged. Later Delivery must select exact artifact IDs, not floating latest output. Review currently permits one immutable approval per Reading; new approval semantics are not invented here. Future new approved content must enter through an authorized new immutable Review/document source.

Historical retrieval does not re-render or consult current design/default/assignment/ProductVersion/deck preference/template defaults/fonts. retrieveDocumentArtifact requires persisted organization/Store membership, exact Reading/artifact/source relationships and AVAILABLE; bounded full read verifies key/MIME/length/SHA. Public metadata excludes key; returned bytes are detached. Foreign/sibling/forged Reading/artifact/key payloads fail before storage access. No URL, seller deletion endpoint, final download UI, delivery or presigning is introduced.

## Validation

Validation totals are recorded below after the final checks. Focused tests are included in full totals, not added twice. Synthetic fixtures only, PGlite DB and Node 22.23.1. Tests cover real renderer metadata/bytes, strict contracts, actual SQL immutability/constraints, duplicate workers/intents, pending writes/lost responses/finalization recovery, late expired claim settlement, bounded retries, ownership/read isolation, storage integrity, history/design/deck retirement, Manual/TEXT/ASSISTED and existing tick integration. Native PostgreSQL acceptance is not claimed.

| Check | Final result |
|---|---|
| Focused artifact unit tests | 18 passed (included in full suite) |
| Focused artifact/workflow DB tests | 31 passed (29 original + 2 recovery regressions; included in full suite) |
| Full unit suite: pnpm test | 369 passed, 34 files |
| Full DB suite: pnpm test:db | 351 passed, 16 files |
| Total | 720 passed |
| pnpm typecheck | PASS |
| NEXT_TELEMETRY_DISABLED=1 pnpm build | PASS |
| git diff --check | PASS |
| pnpm db:generate | PASS, 40 tables, no schema changes/nothing to migrate |
| Migration fresh/replay/history | PASS in full DB suite; fresh runner, replay no-op, populated pre-0020 rows preserved |

Next.js regenerated next-env.d.ts and tsconfig.json during build. Their exact diff was inspected; only the generated declaration imports/comments and allowJs/dev-types/formatting changes were removed. No existing Part 4 work was discarded. No native PostgreSQL or production storage acceptance is claimed.

## Acceptance and MRH handoff

No acceptance status changes: GEMINI-TAROT-01 remains ACCEPTED; the other nine remain OPEN. PDF-REAL-01 needs intended-host actual approved Readings/permitted artwork/artifact storage, visual/long-content/Unicode/determinism/error and memory/concurrency/codec evidence, plus eventual preview parity. TAROT-ASSETS-01 needs actual commercial rights/evidence, complete 78-card mapping and actual binary integrity/availability. STORAGE-REAL-01 needs the real intended private S3-compatible adapter and conditional creation/contention/replay/ambiguous-write/bounded-read/access/retention/recovery acceptance. MEDIA-NATIVE-01 now explicitly includes artifact/work locking, duplicate/expired/late workers and crash/finalization recovery. Real Etsy intake/cardinality and independent delivery/config/UI debts remain unchanged.

Next: **MRH Backend Real Acceptance → Final Seller UI → MRH Seller Pilot → Delivery → Telegram → Billing → Production Hardening**. Part 4 completes internal backend implementation with injected ports, not a ready final seller product/pilot. No unrelated real acceptance ran. Real Gemini calls = 0; real Etsy calls = 0; real tarot artwork = 0; production storage credentials = 0; no push/deployment.

## Intended files

- docs/{ARCHITECTURE,DOCUMENT_ENGINE,DOCUMENT_ENGINE_PART4_REPORT,PILOT_ACCEPTANCE,PRODUCTION_ORCHESTRATION}.md
- drizzle/0020_clean_franklin_storm.sql; drizzle/meta/{0020_snapshot,_journal}.json
- src/db/schema.ts; src/infrastructure/object-storage.ts
- src/modules/documents/{artifact-contract,artifact-service,artifact-storage,media-service}.ts
- src/modules/production/{documents,runtime,tick}.ts; src/modules/review/service.ts
- tests/{artifact-storage.fixture,document-artifact.test,document-artifact.db.test,reading-media.db.test}.ts

Recovery completion preserved the existing migration and implementation. Small final-review corrections recheck approval/holds inside the Store-locked input transaction and use database time for artifact finalization. Two additional meaningful DB regressions cover late superseded settlement and conflicting pending render evidence. The historical migration test's cutoff excludes later migrations while testing its exact historical boundary.
