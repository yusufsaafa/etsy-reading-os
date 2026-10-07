# Document Engine Part 2.5B completion report

Starting commit: `901bf6b7b53478b34da19b6ffde1696c3c1925bb`, branch `codex/ui-ux-design-lock`. The ending commit is the commit containing this report; its SHA is reported in the completion response. Recovered the original interrupted working tree and continued it without recreating the implementation.

## Contracts and versioning

| Area | Completed behavior |
| --- | --- |
| Product configuration | Optional strict `readingMedia` requirement: NONE or TAROT_CARDS with integer cardCount 1–10. No speculative media kinds or Product deck override. |
| Historical versions | Missing configuration means NONE at interpretation time. Published JSON is not defaulted, backfilled or mutated. |
| GenerationContext | Exact ProductVersion configuration and requirement remain in the existing frozen context/hash. Retry uses the admitted context, including after a new ProductVersion. |
| Semantic cards | Exact required count; canonical 78-card vocabulary; UPRIGHT/REVERSED; consecutive zero-based positions equal array order. Duplicate identities and positions are forbidden. No section association is supported. |
| Provider output | Strict bounded `canonical-reading-media/v1` schema uses the existing provider-neutral structuredOutput/Gemini projection. NONE retains the old sections-only contract. Decks, assets, URLs, storage and unknown fields are rejected. |
| Prompt | Tarot-only bounded requirement and deterministic canonical vocabulary, with instructions to keep interpretation consistent. No artwork, preferences, asset or legal metadata goes to AI. |
| Fake provider | First required canonical identities, alternating orientations, deterministic positions. No randomness or real provider calls. |
| Accounting | Existing gateway, attempts, reservations, budgets and settlement remain authoritative. Additional tarot schema bytes enter the existing reservation calculation. Invalid cards follow INVALID_OUTPUT semantics. |
| Review | Existing immutable successful Generation pin also pins cards. Later Generation cannot replace evidence. Drafts contain/edit sections only. |
| Approval | Text and `approved-reading-media/v1` freeze atomically. Separate approved_media artifact records exact requirement, ordered cards, provenance, hash and timestamp. Missing/corrupt required cards block approval. |
| Approved v1 compatibility | `approved-reading/v1` remains sections only with unchanged contentHash semantics. Historical NULL approved_media exposes faithful NONE without writes; tarot NULL fails closed. |
| Document decision | Separate immutable `document-media-snapshot/v1`, paired with existing `document-snapshot/v1` in `document-render-input/v1`. Snapshot v2 was rejected because this slice need not repeat or re-version unchanged text/design contracts. |
| Snapshot compatibility | Existing v1 payload, hash and read behavior remain valid. Snapshot helpers were composed into the new transaction without changing semantic hash inputs. No historical media backfill. |
| Creation | `createDocumentRenderInput` accepts only owned order/Reading intent. One Store-locked transaction freezes text/design, approved media and server-side Store preferred deck. |
| Missing/retired preference | Missing returns explicit DOCUMENT_MEDIA_SETUP_REQUIRED. Retired/unusable preferences fail new creation; no first-deck/default substitution. NONE needs no preference. |
| Assets | Each approved card resolves via the exact trusted deck/version boundary. Freeze cardKey/orientation/position, deck key/version and asset UUID/SHA-256/MIME/dimensions/byte size. No storage keys, URLs, credentials, legal notes, customer body or provider metadata. |
| Presentation | Existing design cardImagery option remains separate from Product media requirements. No new visual configuration or layout. |
| Text delivery | Semantic approved Reading Media belongs to the Reading, and can be consumed independently of PDF/deck artwork. |

## Hashes, immutable reads and security

Approved text contentHash remains SHA-256 of stable `{sections}`. Approved mediaHash is SHA-256 of stable `{requirement, media}`. Document mediaHash is SHA-256 of stable exact media including ordered semantic cards and deck/asset evidence. Combined renderInputHash is SHA-256 of stable `{snapshotHash, mediaHash}`. Creation/approval timestamps and database provenance are excluded from semantic media hashes; ownership/provenance are separately validated.

The complete-input reader returns detached deeply frozen values, verifies parent/approval/provenance/hash and retained exact deck/asset metadata, and never supplies input from current preference/design/draft/latest Generation state. Retirement preserves historical exact resolution. Preference changes, new versions/assets, later Generation, Product changes and Style changes do not alter an existing input. Identical creation reuses the unique owned snapshot/media-hash intent; an intentional new preferred deck creates a different media input alongside the same text/design snapshot.

Strict commands reject client cards/deck/version/assets and extra ownership fields. Cross-organization, sibling Store, forged order/Reading pairs and foreign immutable-media reads are rejected. Malformed durable semantic evidence, approval/hash/provenance and frozen metadata fail closed, including corruption with a recomputed hash. Reads do not repair, regenerate, substitute or fall back.

Store-first transaction locking serializes creation with Store preference/design changes. The selected exact deck version is locked FOR SHARE through commit, coordinating retirement. Unique intent and Store lock make concurrent duplicate creation coherent. PGlite overlap tests exercise application behavior but do not prove native PostgreSQL multi-connection lock timing; that acceptance remains OPEN.

## Persistence and migration

Additive migration `0019_free_swarm.sql` adds nullable `reading_reviews.approved_media` and `document_media_snapshots`. The new table has owned approval/Reading/Generation references, parent snapshot reference, bounded payload and unique owned parent/media hash. SQL approval/draft guards preserve immutable pins/body revisions and validate semantic evidence. Document media inserts validate parent ownership, exact approval, preference/version, complete manifest and mapped assets; updates/deletes are forbidden.

No destructive schema changes, historical JSON mutation, fabricated cards, Store preferences, media records, copyrighted seeds or artwork imports. The historical Part 2.5A migration test was corrected to replay only migrations preceding 0018 before applying 0018, instead of inadvertently running the new 0019 without its prerequisite. Populated pre-0019 text Generation/Review/snapshot fixtures preserve every historical column. The migration runner is tested from scratch and then repeated as a no-op. Schema generation reports no drift.

## Acceptance ledger and scope

`PILOT_ACCEPTANCE.md` contains OPEN debts classified as BLOCKS MRH PILOT, BLOCKS PRODUCTION LAUNCH or NON-BLOCKING FOLLOW-UP: native PostgreSQL concurrency, real Etsy paid-order/OAuth/intake/mapping/production, real replay/mixed-cart/quantity payloads, real PDF fonts/assets/long text/Unicode/determinism, real tarot rights/78 mappings/binary integrity/storage, current official Etsy Delivery capabilities, final Generation/Style Analysis production configuration smoke with new IDs, real storage adapter acceptance and final pinned-card Review UI. Conditional capability gates are explicit.

A fresh controlled real Gemini acceptance **is required before enabling TAROT_CARDS products in MRH pilot**, because the schema/prompt/output contract changed. Historical text-only acceptance does not cover it. No acceptance call was made during implementation. Native PostgreSQL debt from Part 2.5A remains unresolved, not silently marked passed.

No real artwork, billing/entitlements, renderer, pagination, preview, PDF, delivery, manual card editing, Product deck override or final seller frontend was implemented. Part 3 receives the exact immutable combined input, retrieves trusted bytes through PlatformAssetStorage, verifies digest/length and owns decoding/layout/reversed presentation/pagination/PDF.

## Validation

Recovered validation completed successfully using Node 22.23.1:

- `pnpm test`: 244 unit tests, 30 files, all passed (25 new focused media unit cases).
- Focused `pnpm test:db tests/reading-media.db.test.ts`: 12 passed.
- Full `pnpm test:db`: 317 DB tests, 15 files, all passed. Combined unit/DB total: 561 distinct tests.
- `pnpm typecheck`: passed, including after removing confirmed build-generated tooling noise.
- `pnpm build`: passed.
- `git diff --check`: passed.
- Migration replay from scratch and repeat/no-op, populated historical fixture preservation: passed in the DB suite.
- `pnpm db:generate`: no schema changes, no drift.
- Real Gemini calls: 0. No push or deployment.

The interrupted full DB run had 316 passes and one prerequisite-order failure in the historical 0018 test. Correcting only its migration cutoff restored the full green suite; no domain invariant was weakened.

Changed files (confirmed build-only next-env.d.ts/tsconfig.json noise excluded):

- `docs/DOCUMENT_ENGINE.md`
- `docs/DOCUMENT_ENGINE_PART2_5B_REPORT.md`
- `docs/GENERATION_ENGINE.md`
- `docs/PILOT_ACCEPTANCE.md`
- `docs/PRODUCT_CONFIGURATION.md`
- `docs/READING_MEDIA.md`
- `docs/REVIEW_WORKSPACE.md`
- `drizzle/0019_free_swarm.sql`
- `drizzle/meta/0019_snapshot.json`
- `drizzle/meta/_journal.json`
- `src/db/schema.ts`
- `src/infrastructure/ai/fake.ts`
- `src/modules/documents/media-contract.ts`
- `src/modules/documents/media-service.ts`
- `src/modules/documents/snapshot-service.ts`
- `src/modules/generation/contracts.ts`
- `src/modules/generation/instructions.ts`
- `src/modules/generation/service.ts`
- `src/modules/media/reading-contract.ts`
- `src/modules/media/service.ts`
- `src/modules/products/contracts.ts`
- `src/modules/review/approved-media.ts`
- `src/modules/review/service.ts`
- `tests/media.db.test.ts`
- `tests/reading-media.db.test.ts`
- `tests/reading-media.test.ts`
