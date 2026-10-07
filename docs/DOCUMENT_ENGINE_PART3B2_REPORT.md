# Document Engine Part 3B-2 report

Completed 2026-10-07 from `dfbeea7248f354e597aa5e694566b4eebc289716` on `codex/ui-ux-design-lock`. The starting branch/history/tree checks passed. Completion commit is the commit containing this report (avoids a self-referential commit hash).

## Implementation and version decisions

- **Renderer:** pinned pdf-lib **1.17.1**, MIT (upstream package LICENSE.md/package.json), retained application identity **reading-pdf/1**. Low-level PDF objects, buffer image embedding and serialization provide offline Node operation without browsers, HTML/CSS or runtime network. A custom Type0/CID font path is necessary because convenience text APIs cannot authoritatively consume the existing shaped glyph positions. No second shaping or pagination engine was added.
- **Chain:** owned immutable mediaSnapshotId → getDocumentRenderInput → existing production layout engine → verified resource preparation → PDF painter → reopen validation → detached result bytes. `renderDocumentPdfForReading` derives organization/Store ownership through existing boundaries; client resource/deck/font/path overrides do not exist.
- **Contracts:** existing document-layout/v1 and document-render-resources/v1 are unchanged. Strict internal request accepts layout/resources and optional retained rendererVersion only. Result metadata is strict **validated-document-pdf/v1**: layoutHash, resourceHash, rendererVersion, SHA-256, byteLength, pageCount and metadataPolicy. Backing bytes are private, with detached copyBytes ownership. No PDF JSON snapshot, artifact persistence, database or migration change.
- **Fonts:** exact verified Inter v4.1 Regular and Source Serif 4.005R Regular, static normal/400 full TTF bytes; no standard/host/network fallback. SemiBold/Bold are retained upstream but not selected by current layout roles. CIDFontType2 with explicit glyph-ID map, actual width table and per-glyph Unicode CMap embeds the unmodified bytes. Code points are now exposed alongside the existing controlled shaped-run glyphs for the CMap; metrics/measurement identities/old layout hashes are not changed.
- **Text:** the same Fontkit 2.0.4 controlled shaping path supplies original IDs and x/y advances/offsets, kerning, ligatures and combining marks. Every resolved line source range is shaped and painted glyph-by-glyph with absolute text matrices. Baseline uses retained global ascent; x origin applies negative inkLeft. Exact formulas are in DOCUMENT_ENGINE.md. No paragraph drawText convenience path, independent wrapping, fitting, text normalization or pagination occurs. ActualText UTF-16BE retains exact line source; ToUnicode supports text extraction.
- **Units:** integer milli-points convert to PDF points by /1000 at the physical boundary; top-left layout coordinates convert to bottom-left PDF coordinates. Numeric operators round to 1e-6 point; no PDF floating-point value changes layout or hashes.
- **Primitives/templates:** all current TEXT/BODY roles, CARD, DIVIDER, CELESTIAL/EDITORIAL/END_RULE ornaments, IVORY/PARCHMENT/WHITE backgrounds and NONE/RULE/ANTIQUE frames are explicitly mapped. Original vector geometry needs no external decorative resources. Mystic Parchment, Luxury Editorial, Minimal, Tarot Atelier, Classic and Modern share one painter. Historical template/design/layout/provider meaning is retained. Unsupported tokens fail closed.
- **Images:** verified PNG/JPEG embed directly. Verified WebP converts in memory using Sharp 0.35.5 with explicit bounded PNG options; original asset evidence is unchanged. Exact CARD.image geometry preserves aspect fit from layout, with no PDF-specific fitting. REVERSED artwork uses a negative width/height matrix for exact 180° rotation within the slot; captions stay upright. Imagery OFF has zero tarot reads/resources/operators while approved cards remain intact. No real artwork was imported.
- **Determinism:** fixed producer, no creation/modification date or host/path/model data; document ID is derived from stable layoutHash/resourceHash/rendererVersion. Object/resource/CID order is stable, object streams/appearance updates disabled. Same exact inputs/resources repeat identical bytes/SHA locally. PNG/JPEG/WebP output and cross-host codec equivalence remain intended-runtime acceptance concerns; paint/codec semantic changes require a new retained renderer version.

## Validation and limits

Runtime validation checks signature/EOF/size, reopens the PDF, checks page count/A4 dimensions, minimal metadata/no encryption, exact full embedded font SHA-256, font dictionaries/ToUnicode, image XObjects and content streams. It is a separate read pass; independent local PyMuPDF QA additionally proves parser/render usability. This is not PDF/A certification.

Existing resource bounds remain (2 MiB/font, 25 MiB/image, 8192 dimensions, 16M pixels/image, 32M aggregate pixels, 64 MiB encoded resources, 10 images). Renderer bounds add 1000 pages, 1M glyphs, 65,534 CIDs/font, 32 MiB uncompressed commands, 64 MiB PNG preparation and 128 MiB final PDF. Reads/conversion are sequential; private copies are deliberate. Library-held decoded buffers and reopen/serialization allocations mean a strict peak-RSS guarantee is not claimed. Intended-host memory/concurrency testing remains acceptance debt. Violations fail without dropping or truncating content.

Strict validation and trusted-instance guards block resource clones/substitution, corrupt layout/provider/hash/geometry/fonts/media, URLs/paths/raw commands and provisional output. Approved strings enter only UTF-16/glyph hex encoding. Foreign organizations, sibling Stores, forged membership and forged identity payloads are rejected before resource access through the owned service. Bounded errors cover layout readiness, mismatches, missing resources, unsupported primitives, geometry, glyph/content/resource/output limits, rendering and PDF reopen/page/dimension failures. There is no fallback font/image/template.

| Check | Result |
| --- | --- |
| Unit suite | **351 passed / 33 files** |
| Focused PDF unit coverage | **30 passed** (included above) |
| Full DB suite | **320 passed / 15 files**, PGlite |
| Reading-media DB coverage | **15 passed** (included above); owned PDF assertions extend the resource/tenant test |
| Total unit + DB | **671 passed** |
| pnpm typecheck | PASS |
| NEXT_TELEMETRY_DISABLED=1 pnpm build | PASS |
| git diff --check | PASS |
| pnpm db:generate | PASS: 38 tables, no schema changes/nothing to migrate |
| Migration | None added; existing full DB setups replay migrations into fresh PGlite and existing repeat/historical-preservation tests pass |
| Real Gemini calls / real tarot artwork | **0 / 0** |
| Runtime font/image/PDF network | **0** |

Next.js-generated next-env.d.ts imports/comments and tsconfig formatting/allowJs/dev-type entries were inspected and restored only after confirming build tooling noise. No other work was discarded.

## Regression and independent visual evidence

Thirty focused tests cover strict contracts, identity/hash/readiness, repeated byte determinism, exact full font embedding, every glyph matrix, exact line/fragment order, long continuation, short-section packing, long footer, Turkish/accented Latin/ligatures/marks/tabs, unsupported scripts, command injection boundaries, NONE/imagery OFF, 1–10 cards, PNG/JPEG/WebP, all templates and malformed PDF/page/dimension failures. Existing Part 1/2/media/review/generation/production/style tests remain green.

Reproducible synthetic fixtures: `scripts/verify-pdf-fixtures.ts` writes PDFs/layout/glyph evidence only to an explicit QA directory. Fixed synthetic UUIDs and red/blue rectangular pixels make repeat fixture creation deterministic. The optional `scripts/inspect-pdf-fixtures.py` uses **PyMuPDF 1.26.7** in an isolated QA venv; its AGPL/commercial license is separate from the production MIT library and it is not shipped as an application dependency.

Executed locally: six PDFs, **35 pages**, independent repair-free parsing, dimensions/font usability and Turkish extraction; **65,373 original glyph IDs/origins/sizes** matched the expected shaped paint positions within .002 pt. Every page was rasterized twice with identical pixels; visible synthetic card color markers proved upright/reversed presentation. Covers, media pages and long reading pages were visually inspected without clipping/overlap or missing characters. QA evidence/raster PNGs are scratch outputs, not persisted production artifacts. Automated unit checks inspect PDF operators; independent optional raster QA is repeatable but not a portable golden baseline across tool upgrades.

## Acceptance and Part 4

PILOT_ACCEPTANCE.md distinguishes implemented prerequisites from real acceptance. **GEMINI-TAROT-01 stays ACCEPTED**, with its original evidence untouched. **All nine other debts remain OPEN.** No unrelated external acceptance ran.

- **PDF-REAL-01:** intended host/runtime, representative actual approved Readings, approved real assets when permitted, final visual inspection, long-content/font/glyph/Unicode and failure behavior, memory/concurrency/native codec output, future shared preview/PDF parity and intended Part 4 artifact/storage path.
- **TAROT-ASSETS-01:** actual artwork commercial SaaS/PDF rights/evidence, complete exact 78-card mapping, actual binary MIME/dimensions/length/digest and immutable availability. Synthetic rectangles cannot close it.
- **STORAGE-REAL-01:** intended S3-compatible adapter, bounded reads/access/write-once keys, retention/recovery, digest/length failures and real availability. This milestone returns memory bytes only.
- **MEDIA-NATIVE-01:** native PostgreSQL multi-connection locking/concurrency; PGlite is not native acceptance. Etsy, AI configuration and Review card UI debts remain independent.

Part 4 consumes ValidatedDocumentPdf and owns immutable artifact records, ownership/Reading linkage, production object writes, write-once/idempotency, lifecycle/regeneration/workflow recovery, retrieval/download and eventual Delivery. No artifact, preview, seller UI, billing, delivery, Product/Generation/Review semantic change, real AI call, push or deployment was implemented here.

## Files changed

- package.json; pnpm-lock.yaml
- src/modules/documents/pdf/{contract,font,renderer,service}.ts
- src/modules/documents/resources/fonts.ts (additive shaped glyph Unicode evidence only)
- tests/{document-pdf.test,pdf.fixture,reading-media.db.test}.ts
- scripts/{verify-pdf-fixtures.ts,inspect-pdf-fixtures.py}
- docs/{DOCUMENT_ENGINE.md,DOCUMENT_ENGINE_PART3B2_REPORT.md,PILOT_ACCEPTANCE.md,READING_MEDIA.md}

Extraction detail: valid cached font component glyphs can lack Fontkit code-point arrays. Their ToUnicode mapping is recovered from the retained font's own cmap where available; contextual unmapped glyphs rely on exact ActualText instead of invented replacement characters. All measured IDs/positions remain unchanged, and independent glyph/raster validation was rerun after this correction.
