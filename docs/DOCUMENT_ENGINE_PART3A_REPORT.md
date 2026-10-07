# Document Engine Part 3A report

Starting commit: `c5cd5f06d89d7078e6db2fb41c05f45038935a8d`. Branch: `codex/ui-ux-design-lock`. Ending commit is the commit containing this report, reported in the completion response. Preflight confirmed correct branch, base ancestry and a clean working tree.

## Delivered architecture

| Area | Implementation |
| --- | --- |
| Entry point | `getDocumentLayout(db, scope, mediaSnapshotId)` reads the existing owned immutable render input and composes without writes. Pure `composeDocumentLayout` is a server-only derivation, not a client authorization API. |
| Shared model | document-layout/v1 contains exact ordered pages, measured line ranges and resolved geometry for both future preview and PDF. Neither consumer may run independent pagination. |
| Units | Integer milli-points (1/1000 PDF point). A4 595276 × 841890. No CSS/viewport units, browser measurement or floating semantic output. |
| Primitives | TEXT roles, exact ranged BODY fragments, CARD with fitted image geometry and immutable evidence reference, DIVIDER, controlled ORNAMENT; page background/frame and reserved content/footer boxes. Stack/grid composition resolves into these primitives. |
| Typography | Existing Inter and Source Serif 4 identities only. Display, heading, continuation, body, metadata, caption, footer and page-number roles use bounded physical sizes. No font download or binary embedding. |
| Measurement | Server-owned TextMeasurement port and retained controlled-advance/1 provider. Explicit provisional width classes/code-point ranges/font factors; productionReady=false in every layout. Different character advances drive line breaks, not character-count pagination. Unsupported/mismatched provider identity fails; no silent metric substitution. |
| Pagination | Fixed body sizes, measured lines, keep heading + divider + two lines (or whole one-line body), whitespace/paragraph-aware page breaks, two-line widow/orphan target when feasible, smaller continuation headings, multi-section packing, exact footer reservation and additional media/cover pages. No auto-shrink or clipping. |
| Integrity | Section IDs/titles/order and exact bodies retained. Ordered UTF-16 fragments reassemble to exact source; independent body digests/length and measured line coverage validate output. Media/card/deck/asset evidence stays exact. |
| Contract | Strict validated document-layout/v1; source semantic hashes, template/engine/measurement identities, A4 and footer bounds, section manifest, media evidence, pages/elements/geometry/styles, distinct layoutHash. Detached deeply frozen output. |
| Hash | SHA-256 stable JSON of full semantic layout excluding only layoutHash. Includes source hashes, versions, measured lines, content, media, styles and geometry; no clocks/database IDs. Existing hashes unchanged. |
| Persistence | Ephemeral deterministic recreation from immutable input + retained layout/template/measurement versions. No table, migration, backfill or artifact write. Future Part 4 can pin layoutHash/versions or deliberately add immutable persistence. |
| Compatibility | Existing classic/mystic/minimal/modern keys and v1 definitions retained. Additive luxury-editorial/tarot-atelier keys; no historical rename or changed snapshot/hash semantics. Layout definitions are independently versioned for the first time. |
| Representatives | Mystic Parchment (mystic), Luxury Editorial, Minimal and Tarot Atelier work through one engine with distinct background/frame/ornament/inset/typography/grid tokens. Classic Ivory and Modern also resolve. Six remaining families are future bounded registry additions, not placeholder selectable definitions. |
| Tarot | 1 centered hero; 2 pair; 3 spread; 4 2×2; 5–10 controlled 2/3-column grids with centered final rows and extra gallery pages. Cards remain legible; impossible fit/aspect fails rather than omission/distortion. Frozen positions/name/orientation/evidence preserved; no bytes read. |
| Seller configuration | Existing bounded brand/color/fonts/cover/display/footer configuration only. cardImagery OFF suppresses slots but retains semantics. No unsupported reader/question fields, logo URLs, UI/editor fields or arbitrary layout code. |
| Security | Owned immutable reader precedes layout service. Cross-org/sibling/forged identities fail; pure input validates parent/hash relationships. Untrusted cached layout must validate against full deterministic source recreation. No tenant payload accepted by service. |
| Corruption | Unknown fields, font/template/version/measurement mismatch, hash/media corruption, invalid geometry/reserved zones/overlap, missing/reordered/duplicated content/cards or mismatched source fail closed. No fallback or read repair. |

Detailed algorithms, exact sizes/bounds and retained-version policy are documented in DOCUMENT_ENGINE.md. Resource limits are 1,000 pages/5 MB layout serialization; pathological over-limit content fails explicitly, with no truncation. Provisional Unicode advances preserve text and code-point boundaries but do not claim final multilingual shaping/kerning or pixel-perfect PDF geometry.

## Acceptance and Part 3B

PDF-REAL-01 stays OPEN. Its requirements now explicitly include actual font metric/shaping equivalence and preview/PDF parity against the same page/line geometry. GEMINI-TAROT-01 stays ACCEPTED, unchanged. Native PostgreSQL MEDIA-NATIVE-01 and all other independent debts remain unchanged and OPEN. PGlite tests do not establish native multi-connection acceptance.

Part 3B owns exact PlatformAssetStorage bytes, SHA-256/length/image decode validation, controlled font binaries/embedding and production measurement/shaping integration, REVERSED image transforms, ornament/background primitive rendering, document-layout/v1 → PDF bytes, deterministic PDF metadata, Unicode/multilingual validation and preview renderer parity. A production metric implementation must receive a new retained version and shared-engine acceptance; it cannot replace controlled-advance/1 silently.

No PDF bytes, renderer library, browser preview, seller screen, cloud storage adapter, real artwork/font imports, billing, delivery, Generation/Review changes or real Gemini calls. No push or deployment.

## Validation

Node 22.23.1 validation completed:

- `pnpm test`: **280 unit tests**, 31 files, passed.
- `pnpm test:db`: **318 DB tests**, 15 files, passed (PGlite). Combined total **598**.
- Focused layout tests: 36 passed; focused media DB tests: 13 passed. These are included in the totals.
- `pnpm typecheck`, `pnpm build`, `git diff --check`: passed.
- No migrations added. Existing migration runner replay/repeat and populated historical preservation tests remain green; `pnpm db:generate` reports no schema changes/drift.
- Confirmed Next.js build-generated next-env.d.ts/tsconfig.json diffs were inspected and only that noise restored.
- Real Gemini calls: **0**. No push or deployment.

Added 36 focused unit cases and one owned-layout integration case in the existing media DB suite. Tests cover six compatible/additive keys and four representatives, long exact content, deterministic hashes, Unicode/overlong-token preservation, 1–10-card galleries, display OFF, long footer/cover flow, ownership, corruption and measurement/source mismatch.

## Files changed

- `docs/DOCUMENT_ENGINE.md`
- `docs/DOCUMENT_ENGINE_PART3A_REPORT.md`
- `docs/PILOT_ACCEPTANCE.md`
- `docs/READING_MEDIA.md`
- `src/modules/documents/contracts.ts`
- `src/modules/documents/layout/contract.ts`
- `src/modules/documents/layout/engine.ts`
- `src/modules/documents/layout/measurement.ts`
- `src/modules/documents/layout/service.ts`
- `src/modules/documents/layout/templates.ts`
- `tests/document-layout.test.ts`
- `tests/layout.fixture.ts`
- `tests/reading-media.db.test.ts`
