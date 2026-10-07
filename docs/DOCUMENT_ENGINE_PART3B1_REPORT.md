# Document Engine Part 3B-1 report

Completed 2026-10-07 on codex/ui-ux-design-lock. Starting commit: `16fb47c722b6270be68dd8987aef094a9cf08211`. Ending commit is the commit containing this report, titled `feat(documents): add trusted rendering resources`; its exact SHA is returned in the completion response. No push or deployment.

## Implemented architecture

Controlled local font packages → strict registry and byte/license verification → production-font-metrics/1 → the ONE existing Part 3A layout engine → document-layout/v1. Owned immutable document input → visible CARD frozen identity → platform metadata → bounded storage read → byte integrity → full bounded image decode → ephemeral document-render-resources/v1. Part 3B-2 will consume layout plus these verified resources; no PDF bytes are produced here.

The new module is src/modules/documents/resources: bytes/error/limits and private copied-byte holders; fixed manifest pins; fonts/provenance validation and controlled shaping; production measurement; image validation; strict bundle/hash and owned service. Existing media byte integrity is reused through the exact trusted asset boundary. No duplicate object-storage architecture, persistence, migrations or schema changes.

## Official font packages

- Inter: official https://github.com/rsms/inter, **v4.1**, source commit `e3a3d4c57d5ecc01453a575621882a384c1995a3`, official `Inter-4.1.zip`, original `extras/ttf/` static files. License: `resources/fonts/inter/4.1/LICENSE.txt`. Manifest: `resources/fonts/inter/4.1/provenance.json`.
- Source Serif 4: official https://github.com/adobe-fonts/source-serif, **4.005R**, source commit `2823e993c53fca27c5c8749f529b56a5a7c77b6b`, official `source-serif-4.005_Desktop.zip`, original `source-serif-4.005_Desktop/TTF/` static files. License: `resources/fonts/source-serif-4/4.005/LICENSE.md`. Manifest: `resources/fonts/source-serif-4/4.005/provenance.json`.

Both packages preserve unmodified upstream SIL Open Font License 1.1 text and copyright/reserved-name notices. SHA-256 and lengths were computed locally after official release extraction. Manifests also retain release URL/asset context, archive SHA, license SHA and source paths; code pins manifest SHA. This records upstream evidence rather than inventing legal conclusions. No third-party font source, Google Fonts, system font, variable font, implicit optical sizing, derivative font, italic or new Document Design font identity is used.

| Package | File | Weight | Bytes | SHA-256 |
| --- | --- | --- | --- | --- |
| inter / 4.1 | Inter-Regular.ttf | 400 | 411640 | `40d692fce188e4471e2b3cba937be967878f631ad3ebbbdcd587687c7ebe0c82` |
| inter / 4.1 | Inter-SemiBold.ttf | 600 | 419744 | `78a843fade9d4612a5567302fb595b56976eb5fcebf4fea5a5912d638bafcde3` |
| inter / 4.1 | Inter-Bold.ttf | 700 | 420428 | `288316099b1e0a47a4716d159098005eef7c0066921f34e3200393dbdb01947f` |
| source-serif-4 / 4.005 | SourceSerif4-Regular.ttf | 400 | 261868 | `e5a4ee6a3d87bb9024796be390c6771e2a0eb1883dae25effaf57ca01668e24b` |
| source-serif-4 / 4.005 | SourceSerif4-Semibold.ttf | 600 | 272088 | `36db62940cb5728b12b1802476dc7fcf4c6c519a7bdd476ba23a4e555fc4655f` |
| source-serif-4 / 4.005 | SourceSerif4-Bold.ttf | 700 | 271568 | `7cf4f4e1ad74f45058d5bc61716b82560442fbdcd9d3654d2dea96bf6c683d86` |

## Measurement and productionReady

Fontkit **2.0.4**, pinned MIT package, implements actual TTF advances/ink, kerning, GSUB ligatures and GPOS combining positioning under fixed latn/dflt/ltr and kern/liga/clig/mark/mkmk. Normal/400 is explicit for existing inter/source-serif-4 layout font keys because the current design contract has no weight selector. 600/700 resources are verified and registry-resolvable but are not silently substituted for headings.

production-font-metrics/1 retains a fixed font resource hash `83c0bd3b0e49b608625975d982b9cfc77cdf119a87dd4695cfb2afc5964de66e`, library/capability identity, exact resources and whole-run wrapping policy. Changing those requires a new version. Latin/Turkish and supported precomposed/combining Latin are usable; selected common punctuation, whitespace and TAB-as-four-spaces are explicit. No normalization/replacement: approved text offsets reconstruct exactly. Unsupported scripts/emoji/bidi/surrogates, missing glyphs or out-of-range shaped ink fail. This does not claim complete Unicode/complex-script shaping. Final multilingual PDF remains deferred.

productionReady=true requires verified pinned resources, a trusted production provider instance, supported text/glyph/ink and validated geometry/measurement. It is not PDF acceptance. Global retained font ink/ascent/descent bounds provide sufficient line heights; whole shaped word candidates drive wrapping, with combining-safe emergency breaks. The future renderer must use the same shaped glyph positions, units-per-em scaling, baseline and negative-inkLeft origin adjustment, not an independent library wrapper. Bounded per-provider width caching changes no semantics.

controlled-advance/1 and historical wrapping/geometry remain unchanged and productionReady=false. document-layout/v1 safely accepts a strict additional descriptor; v2 is unnecessary. The production-specific 100-point line-height bound supports actual font vertical extents; original provisional 80-point validation is retained. All templates/paragraph/heading/footer/continuation/card placement use the same engine. Distinct provider descriptor/resource hash enters the existing layoutHash formula; all text/design/media/snapshot hashes remain unchanged.

## Trusted image/resource behavior

Exact UUID/digest/MIME/byte size/dimensions must agree with server-owned immutable platform metadata. Storage reads use only that object's key and explicit maxBytes. Original bytes must match length and recomputed SHA-256, then signature/declared format, actual decoded dimensions and complete compressed stream. Sharp **0.35.5** (Apache-2.0, with upstream native dependency notices), previously Next-transitive and now direct/pinned, performs warning-strict, timed full raster decode. PNG/JPEG/WebP only; SVG/HTML/GIF/other formats rejected. APNG/multipage animation, non-identity EXIF orientation and malformed PNG/WebP framing fail. No image transformations, current preference/latest-deck lookup or fallback occur.

Limits: font 2 MiB; six controlled font resources; image 25 MiB/8,192 dimension/16 million pixels; ten unique images; bundle 64 MiB encoded/32 million pixels; sequential decode and 10-second decoder timeout. Aggregate limits precede storage/decode. The future adapter must bound streaming reads, and real deployment memory/concurrency behavior remains acceptance debt. No real S3 implementation exists.

Bundles are ephemeral strict document-render-resources/v1 manifests and private verified bytes. resourceHash hashes layout identity, exact measurement, ordered controlled font evidence, deduplicated asset evidence and ordered visible card association/orientation. No creation times, host paths, source object keys, URLs, credentials, raw persistence/provider/AI data. Deeply frozen detached metadata and copyBytes() protect the retained backing bytes; typed arrays themselves are not falsely claimed frozen. Trusted-instance guards prevent an unverified clone from becoming a production provider/resource bundle. Raw manifest validity alone cannot bless bytes.

Imagery OFF produces no image reads and preserves all semantic media. UPRIGHT/REVERSED share original source bytes; rotation is Part 3B-2. Identical preparation is deterministic and deduplicates an exact shared asset ID; inconsistent metadata under one ID fails. Store preference changes/retirement do not change historical layout/resources, demonstrated in the owned integration test.

Only immutable document ID is accepted by production owned services. Organization, sibling Store, forged user/ID/parent/resource attempts fail before storage. No client deck/asset/path/font/hash override API exists. Errors fail closed for missing/unusable assets/fonts, storage, integrity, MIME, dimensions/decode, limits, unsupported font/style/weight/glyph/shaping, mismatched provider/hash or unknown resources. No repair/substitution or content removal.

## Validation

- Unit: **321 tests / 32 files passed**; includes **41 focused rendering-resource tests** and all 36 retained Part 3A layout tests.
- DB: **320 tests / 15 files passed**, PGlite; focused Reading Media DB suite **15 passed**, including two new owned rendering-resource tests. **641 total** unit + DB tests.
- pnpm typecheck: passed, including after restoring inspected Next-generated tooling noise.
- pnpm build: passed with NEXT_TELEMETRY_DISABLED=1. Automatic approval review rejected the earlier build check due to possible telemetry; validation was repeated with telemetry disabled.
- git diff --check (working and staged): passed. Adobe’s byte-exact upstream license contains one trailing space; .gitattributes scopes a whitespace exception to that license only. License SHA and text are unchanged.
- pnpm db:generate: reports no schema changes/nothing to migrate. No migration/schema file added or modified. Existing replay/repeat/no-op/history tests pass in the full DB suite; no new backfill or fabricated data.
- Tests/build/resource runtime do not fetch fonts. Network acquisition was restricted to authorized official release resources and the explicitly authorized Fontkit dependency; resources are local thereafter.

Production Orchestration/Generation/Review/Style Intelligence and historical snapshot/media behavior remain green. No new AI/provider calls, Generation/Review/Product semantics, real tarot artwork, PDF renderer, seller UI, billing or delivery. **Real Gemini calls = 0.**

## Ledger and Part 3B-2 handoff

PILOT_ACCEPTANCE.md receives implementation-prerequisite context only; GEMINI-TAROT-01 remains ACCEPTED with unchanged evidence, all other statuses remain OPEN. MEDIA-NATIVE-01 still requires native multi-connection PostgreSQL; PGlite cannot close it.

PDF-REAL-01 still requires actual PDF font embedding/glyph rendering, image/decorative output, long content/pagination, multilingual/error policy, deterministic PDF metadata/bytes, preview/PDF page/line parity, intended-host codec/memory/concurrency and rendering failure acceptance after Part 3B-2/4. TAROT-ASSETS-01 still requires actual verified commercial rights/evidence, exact 78 cards, binary/decode integrity and storage availability. STORAGE-REAL-01 still requires the intended bounded S3 adapter, access/write-once/retention/recovery/availability and failure acceptance.

Part 3B-2 owns choosing the PDF renderer, embedding exact controlled font bytes, consuming shared glyph/line/page geometry, rendering verified CARD bytes with 180-degree REVERSED presentation, painting original code-owned primitives/decorations/footer/page numbers, deterministic metadata, PDF validation and representative-template visual/parity acceptance. No renderer/PDF output, production launch, push or deployment was performed.

## Files changed

- `.gitattributes`
- `docs/DOCUMENT_ENGINE.md`
- `docs/DOCUMENT_ENGINE_PART3B1_REPORT.md`
- `docs/PILOT_ACCEPTANCE.md`
- `docs/READING_MEDIA.md`
- `next.config.ts`
- `package.json`
- `pnpm-lock.yaml`
- `resources/fonts/inter/4.1/Inter-Bold.ttf`
- `resources/fonts/inter/4.1/Inter-Regular.ttf`
- `resources/fonts/inter/4.1/Inter-SemiBold.ttf`
- `resources/fonts/inter/4.1/LICENSE.txt`
- `resources/fonts/inter/4.1/provenance.json`
- `resources/fonts/source-serif-4/4.005/LICENSE.md`
- `resources/fonts/source-serif-4/4.005/SourceSerif4-Bold.ttf`
- `resources/fonts/source-serif-4/4.005/SourceSerif4-Regular.ttf`
- `resources/fonts/source-serif-4/4.005/SourceSerif4-Semibold.ttf`
- `resources/fonts/source-serif-4/4.005/provenance.json`
- `src/infrastructure/object-storage.ts`
- `src/modules/documents/layout/contract.ts`
- `src/modules/documents/layout/engine.ts`
- `src/modules/documents/layout/measurement.ts`
- `src/modules/documents/resources/bundle.ts`
- `src/modules/documents/resources/bytes.ts`
- `src/modules/documents/resources/font-pins.ts`
- `src/modules/documents/resources/fonts.ts`
- `src/modules/documents/resources/images.ts`
- `src/modules/documents/resources/measurement.ts`
- `src/modules/documents/resources/service.ts`
- `src/modules/media/service.ts`
- `tests/document-resources.test.ts`
- `tests/reading-media.db.test.ts`
- `tests/render-resources.fixture.ts`
