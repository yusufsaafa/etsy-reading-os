# Document Engine

Parts 1–2 establish presentation configuration and immutable semantic snapshots. **Neither part renders documents or creates PDFs.** Frontend implementation is intentionally deferred.

The future pipeline combines the Review-owned `approved-reading/v1` value from `getApprovedReadingForDocument(...)` with `resolved-document-design/v1`, then creates an immutable Document Snapshot, followed by deterministic layout/pagination and preview/PDF. Review owns approved body content. Document consumers must never obtain body content from latest Generation, current draft, Review persistence internals, Style Intelligence or provider output.

## Controlled design domain

`src/modules/documents` owns reusable Store-owned presentation designs, platform registries, assignment and resolution. It is independent of Review, Generation, orchestration and AI accounting. No reading content or AI/provider metadata is stored in designs.

Base templates are code-owned supported layout families: `classic`, `mystic`, `minimal`, `modern`, currently template version 1. Sellers cannot supply executable HTML/CSS, coordinates or arbitrary layouts. Template definitions describe capabilities; no rendering exists. Classic and Mystic permit the future card-imagery display preference; Minimal and Modern do not. This preference supplies no images and does not claim asset support.

`document-design/v1` is a strict Zod contract: template; plain brand name (120 characters); primary/accent colors; controlled heading/body fonts; SIMPLE or BRAND cover; explicit customer-name, reading-date, section-divider, card-imagery and footer booleans; optional-in-meaning empty footer text (500 characters). All fields are required for deterministic configuration. Unknown fields are rejected. Design name is nonblank and at most 100 characters. Text rejects angle brackets; arbitrary HTML and CSS fields are unsupported. Configuration is bounded to 8 KiB. Six-digit hex colors normalize to uppercase; CSS functions, variables, URLs and fragments are rejected.

Controlled font keys are `inter` and `source-serif-4`, usable for headings and body. Part 1 neither downloads nor bundles fonts. The renderer will map these stable keys to controlled assets. Logo references and PRODUCT_IMAGE covers are deferred: the existing private-object-storage port has no durable owned asset identity. No unsafe URL substitute is accepted.

## Persistence and lifecycle

`document_designs` stores owned identity, name, ACTIVE/ARCHIVED state, validated JSON configuration, revision, default flag and timestamps. Designs are mutable presentation settings with optimistic revision protection, not immutable history chains. Every actual update/default change/archive advances revision; identical writes at the current revision and identical default/assignment requests do not advance state. A stale design update fails with a conflict. Archival is terminal and repeat-safe. Deletion is forbidden.

This model deliberately relies on the future Document Snapshot to freeze exact resolved configuration. Updating a design will not mutate historical document snapshots once that domain exists. No snapshots exist in Part 1.

`product_document_designs` attaches the stable owned Product identity to an owned design. It does not modify ProductVersion or reading semantics. Presentation policy resolves at future document creation; the snapshot will freeze its result. Assignment replacement is deterministic, unique per Product, and may be removed. No seller design/default is fabricated and no existing data is backfilled.

At most one default exists per Store. Archiving any default or assigned design is blocked; remove assignments/default first. Foreign, malformed or unusable assigned designs fail closed rather than falling through to another design. No random fallback occurs.

## Services and immutable boundary

Services provide create, list/get, expected-revision update, archive, set/clear default, assign/unassign Product, and `resolveDocumentDesignForProduct`. Resolution first authorizes the Product, then prefers its assignment, otherwise the Store default. Missing configuration returns explicit `SETUP_REQUIRED`. Invalid durable data throws a bounded unavailable error and is never repaired during reads.

Successful resolution returns `RESOLVED` with a strict detached recursively frozen `resolved-document-design/v1`: organization/Store/Product identity, design identity/name/revision, PRODUCT or STORE_DEFAULT source, template version, exact normalized configuration and SHA-256 configuration hash. The hash uses existing stable JSON serialization. No writable persistence row, Reading body, customer facts, draft API or infrastructure state is returned. Part 2 can combine this value with approved-reading/v1 without knowing persistence implementation details.

All reads verify persisted membership and Store ownership. All writes require the existing owner scope and serialize under the Store row lock. Composite foreign keys enforce Product/design/Store compatibility. A partial unique index guarantees one default, checks bound status/config/revision, and SQL guards protect identity, revision progression, archive retention and active assignment. Assignment guards lock the design row; service locks serialize default/assignment/archive races. No distributed locks, queues or generic command framework are introduced.

## Deferred work

Document Snapshot creation is implemented in Part 2 below. Pagination, page breaks, preview, PDF rendering/storage/download, branding/logo upload, template/design UI and Product assignment UI are deferred. Future preview and PDF must share the deterministic layout model. Controlled customization remains the product direction, not a Canva-like editor. Delivery, billing and AI design generation are outside this domain. Real Gemini calls during Part 1: zero.

## Part 2 — immutable semantic snapshots

**PART 2 DOES NOT RENDER OR CREATE A PDF.** The implemented pipeline is now approved-reading/v1 + resolved-document-design/v1 → document-snapshot/v1 → future deterministic layout/rendering. Frontend remains deferred.

`createDocumentSnapshot(db, scope, {orderId, readingId})` accepts only intent. It verifies the persisted owner scope, locks the Store, consumes the existing approved-reading handoff and design resolution through transaction-composable variants, and persists in the same transaction. The approved-reading/v1 shape remains unchanged. Because that handoff intentionally exposes Product display name rather than Product identity, the Product module derives identity through the exact owned Reading/pinned Generation/ProductVersion relationship. This lookup selects identity only, never body content. No raw Etsy customer context is gathered. Neither content, design, Product ID nor provenance may be supplied by the client.

`document-snapshot/v1` freezes identity/ownership, Reading/order/Product identities, approved customer and purchased-product display names, Reading number/quantity, exact ordered section IDs/titles/bodies, approval timestamp/content hash, design identity/revision/name/resolution source, template key/contract/version, exact validated document-design/v1 config/configuration hash, source Review/Generation provenance, snapshot hash and creation time. Customer questions/answers, draft internals, provider/accounting/style data and arbitrary asset URLs are absent. Generation identity is retained as approved source provenance, not as a body retrieval instruction.

### Three independent hashes

- Approved `contentHash`: existing stable JSON + SHA-256 of `{sections}`, including exact ordered IDs/titles/bodies.
- Design `configurationHash`: existing stable JSON + SHA-256 of the normalized document-design/v1 config.
- `snapshotHash`: SHA-256 of stable JSON containing frozen order identity/reference/customer name; Product identity/display name; Reading number/quantity; exact sections; approval timestamp; template key/contract/version; exact design config. Creation time, snapshot identity, tenant/Reading/review/generation provenance, design identity/revision/name/resolution source and redundant hashes are excluded. Those fields identify/describe provenance, not layout content. Design name is operational metadata, not a document heading. Approved time is included because it supplies the future reading-date display.

Changes to ordered content, display context, template version or presentation config change semantic hash. Changing creation time or provenance alone does not. This v1 meaning must remain stable; future incompatible semantic hash rules require a new contract version.

### Durable storage and idempotency

Additive migration 0017_yielding_peter_quill creates `document_snapshots`, with owned relational references to Reading, Order, Product, approved Review/pinned Generation and source design, frozen JSONB payload, design revision, semantic hash and timestamp. No snapshots are fabricated and no upstream data is mutated.

A unique owned intent key `(organization, Store, Reading, review, design, design revision, snapshotHash)` reuses an identical creation at the exact source revision. Revision changes may intentionally create a new provenance snapshot even if semantics/hash remain equal. This permits later design edits/reassignment to create new snapshots without imposing one snapshot forever per Reading. Serialized Store-locked creation and uniqueness prevent concurrent duplicates. An existing snapshot is validated before being returned; corruption is not overwritten or repaired.

SQL guards forbid every snapshot UPDATE/DELETE and validate insertion against owned approval, exact approved sections/content hash, exact current active design configuration/revision, owned Reading/order/Product/pinned Generation relationships, payload/column identities and creation timestamp. Foreign keys and bounds supplement authoritative application validation. SQL does not implement Zod or hashes; reads validate those again. Payload storage has a 650,000-byte JSONB text guard, allowing PostgreSQL serialization overhead; canonical application JSON is limited to 600,000 UTF-8 bytes, with approved sections independently retaining the existing 512,000-byte aggregate limit. Per-section limits remain 40,000 characters and 1–20 sections. Content is never truncated.

### Rendering read boundary and historical independence

`getDocumentSnapshotForRender` authorizes Store ownership, loads one exact snapshot, validates strict contract, three hashes, timestamps, size, retained template version, denormalized identity consistency and immutable source relationships. It returns a detached deeply readonly/frozen value. It selects approval/identity evidence and owned source-design identity/revision (never configuration), verifying the historical revision cannot exceed the monotonically advancing source revision: it never re-reads approved body, generated body, mutable draft, current design config/default/assignment or latest Generation. No current operational eligibility check or active-design requirement is imposed on historical reads.

Updating the source design, changing Product assignment/default or safely archiving the released source design never changes or invalidates an existing snapshot. New creation must pass the current upstream admission/resolution boundaries; historical rendering uses the frozen snapshot. The source identity rows remain protected by foreign keys/retention rules. Corruption fails closed with DOCUMENT_SNAPSHOT_UNAVAILABLE; no silent substitution/current-state repair occurs.

All settings and snapshot creation use existing Store locks, producing one coherent state when creation races design update/reassignment/default/archive. Production PostgreSQL read-committed transaction semantics let a waiting creation read the committed state after acquiring the lock. There is no automatic retry framework. A released/absent design produces an explicit setup-required failure with no partial snapshot.

### Template evolution

Code-owned `DOCUMENT_TEMPLATE_VERSIONS` retains immutable historical definitions separately from current `DOCUMENT_TEMPLATES` selection. Snapshot validity looks up exact key/version, not a floating default. Adding templates or versions needs no SQL enum/schema redesign; application registries/contracts evolve explicitly. Keep document-design/v1 validation and historical definitions available for old snapshots. Any rendering-semantic template change requires a new version; do not overwrite/reinterpret an old version. Unknown key/version fails closed. Part 3 must implement support for the retained exact versions rather than silently substituting a current template.

### Snapshot versus artifact

A snapshot is immutable semantic input. A future artifact is preview/PDF output derived from one exact snapshot. One snapshot may support preview, PDF and re-rendering without mutable-state resolution. Page dimensions, margins, typography metrics, layout trees, pagination, HTML/CSS, preview, rendering, binaries, storage and downloads remain unimplemented. No asset system, seller UI or provider operation is introduced. Real Gemini calls in Part 2: zero.


## Part 2.5B — exact immutable render input

`createDocumentRenderInput` now composes the unchanged document-snapshot/v1 text/design with a separate immutable document-media-snapshot/v1, returning document-render-input/v1. Snapshot v2 is deliberately not introduced: existing v1 hashes/history remain valid, while a separate media contract avoids duplicating unchanged text/design semantics. Transaction-composable snapshot helpers preserve v1 behavior.

The command accepts only order/Reading intent. Review supplies separately approved-reading-media/v1; server-side Store preference and trusted registry resolve exact deck/version/card assets under Store/version locks. Semantic cards exist independently of design display.cardImagery. Missing setup or corrupt/retired preference fails for new media; NONE needs no deck. Frozen historical media retains exact semantic cards/orientation/order and asset UUID/digest/MIME/dimensions/bytes. Current preference/design/draft/latest Generation do not supply historical render input.

The combined semantic identity is SHA-256 stableJson({snapshotHash,mediaHash}); document mediaHash hashes exact ordered media including deck/version/assets, excluding volatile timestamps/record IDs. Existing approved contentHash, configurationHash and snapshotHash retain their meanings. Duplicate exact creation is idempotent; intentional deck changes produce another frozen media input without changing the first.

Part 3 must consume the combined exact input for media-aware rendering, retrieve exact trusted asset bytes and verify digest/length. Bare historical v1 snapshots remain readable. No layout, pagination, preview or PDF is implemented. Details and acceptance debts: READING_MEDIA.md and PILOT_ACCEPTANCE.md.

## Part 3A — shared deterministic layout

`getDocumentLayout(db, scope, mediaSnapshotId)` first reads the owned immutable document-render-input/v1 through the existing validated boundary, then derives document-layout/v1 without writes. Pure `composeDocumentLayout` is a trusted server composition function, not a client authorization endpoint. Callers must never accept client render-input payloads in place of the owned service lookup. The pure entry point strictly checks input hashes and parent relationships; cached layouts must pass `validateLayoutForInput`, which validates and compares full deterministic recreation.

The pipeline is immutable input → code-owned layout definition → controlled text measurement → resolved pages. Preview and PDF must consume the **same ordered page elements and measured line ranges**. Browser CSS, viewport size, screenshots and PDF-library line wrapping must not repaginate independently. Sample preview can use separately constructed synthetic immutable input through the same engine; no sample API/UI was added.

Canonical unit: integer **MILLI_POINT**, one thousandth of a PDF point (1 pt = 1/72 inch). A4 is 595276 × 841890, obtained by rounding mm × 72 / 25.4 × 1000. All output geometry/line widths/font sizes are integer units. Renderer conversion to points happens only at the edge. Aspect-ratio calculations are rounded down for fit, with integer centering; no unrounded float enters layout hashes.

### Definitions and bounded customization

Existing classic/mystic/minimal/modern keys and document-template/v1 metadata remain retained. Additive keys luxury-editorial and tarot-atelier extend the controlled registry without renaming old designs. Mystic's layout family is MYSTIC_PARCHMENT; classic is CLASSIC_IVORY. Layout definitions have a **separate retained version 1**, and engine reading-layout/1; there was no previous rendered geometry to replace. Any future change to these layout meanings requires a new retained definition/engine/measurement version, not editing a historical implementation in place.

One engine uses code-owned data definitions for margins, role sizes, line height, gaps, controlled cover inset, card grid, background/frame/ornament tokens and continuation treatment. Definitions are strict, bounded, detached and frozen; no seller executable code. Representative Mystic Parchment, Luxury Editorial, Minimal and Tarot Atelier exercise the same primitives, with intentionally distinct frame/background, whitespace/inset, display typography and card grid. Modern and Classic Ivory also work. The other six art directions remain a future bounded library expansion, not unsupported placeholder selections. Twelve families will not require twelve engines.

Existing Document Design brand colors/name, Inter/Source Serif 4 heading/body identities, SIMPLE/BRAND cover, customer/date/divider/cardImagery/footer toggles and bounded footer text are consumed. The display date is the pinned approval UTC calendar date, never today's date. No reader name or question/customer answers are fabricated because the immutable boundary does not contain them. Logos remain deferred: no safe logo identity is in the current design contract. No CSS/HTML/URL/upload/coordinates or new typography identities were added. SIMPLE omits the large brand cover block; BRAND includes it. Page numbering is an engine primitive independent of the optional footer text toggle.

### Primitives and measurement

Resolved elements are TEXT (display, brand, metadata, heading, continuation, caption, footer, page number), BODY with exact section-relative UTF-16 ranges, CARD with trusted evidence position and fitted image box, DIVIDER and controlled ORNAMENT. Page carries content/footer boxes and background/frame tokens. Stack and grid are composition algorithms resolving these elements, not a second renderer language. Background/frame decoration is confined to the page/safe geometry; ornaments reserve real space and never overlay text.

`TextMeasurement` measures controlled font/size advances in integer units. The retained `controlled-advance` version 1 provider is **explicitly provisional**, with fixed ASCII width classes, fixed Unicode code-point ranges, combining/variation/ZWJ zero advances, distinct controlled font factors and deterministic rounding. Pagination is based on these advances, not character counts. It is not production font shaping, kerning or exact font binary metrics; every layout marks measurement.productionReady=false. The engine permits only the retained provider instance/version; arbitrary server/test implementations cannot masquerade under its identity. Future binary-backed measurement needs a new registered provider/version and compatible retained engine rules. No fonts are fetched, decoded or embedded here. Glyph/code-point emergency wrapping preserves surrogate pairs, but complex-script/emoji shaping remains PDF acceptance debt.

### Exact pagination rules

- Margins are controlled 18–22 mm. A minimum 12 mm footer zone is reserved even without footer text. Measured long footer text increases that zone (bounded at 100 points) rather than clipping; page numbers occupy a separate right-hand column. Body never enters it.
- Cover blocks use measured lines and flow to additional cover pages if bounded product/customer metadata is long. No text is discarded or auto-shrunk. Display/heading/body size stays fixed by the template and controlled fonts.
- Reading starts after cover/media. Sections retain input order and may pack on the same page; pages with multiple bodies are identified MULTI_SECTION.
- Heading is kept with at least two available body lines, or the entire body if it has only one. The heading, optional divider and spacing are reserved before any body placement. If they cannot fit, a fresh Reading page is started; impossible heading geometry fails explicitly.
- Whitespace-aware greedy line wrapping uses actual provider advances and preserves spaces, tabs, CR/LF/CRLF and every UTF-16 range. Overlong tokens use code-point-safe breaks, not truncation.
- Body pagination takes measured lines that fit. At a break it prefers the last complete paragraph ending that fits and leaves at least two lines; otherwise it breaks between measured lines. A one-line remainder is avoided by moving one line to the next page when feasible. Continuation pages optionally use a small title + continuation indicator rather than the oversized heading.
- Minimum two body lines per ordinary split where feasible; single-line complete sections remain valid. Blank lines consume space exactly as approved. No shrink-to-fit, summarization, paraphrase, generated closure text or AI.
- The closing END_RULE ornament is added only if space remains; it is not Reading content. All elements are inside safe/reserved boxes; positive integer boxes, line heights, widths, page order and non-overlap are validated.

Layouts are bounded to 1,000 pages and 5 MB serialized output. Pathological input requiring more fails closed rather than being truncated. Existing approved content bounds remain unchanged; ordinary 1,000+ word and near-bound sections paginate naturally. This is a resource bound, not a characters-per-page heuristic.

### Tarot arrangements

NONE creates no media page. cardImagery=false suppresses slots/gallery but retains the exact semantic media evidence in the layout; it never changes approved cards or media hashes. Otherwise 1 card is a centered hero, 2 a pair, 3 a spread, 4 a 2×2, and 5–10 use template-controlled 2 or 3 columns with centered final row and additional media pages. Frames have minimum 100-point width; normal card frame height is 210 points (270 for Atelier), with separate measured name/orientation captions. Artwork fits the exact frozen width/height ratio without asset reads. Images too narrow/short to form a legible slot (below 50/80 points) fail explicitly instead of silently shrinking or distorting artwork. Slot position indexes the layout's exact deck/version/card/asset evidence. REVERSED is retained as semantic orientation and caption; Part 3B performs the visual transform. No historical/current registry preference is used during pure layout.

### Validation, hashes and derived-output decision

Strict document-layout/v1 includes semantic source hashes, template definition/version, engine/measurement identity, page size/reservation, section identity/title/body digest and length, exact media evidence, ordered pages/elements/styles/lines and layoutHash. It excludes database IDs, clocks, AI/provider/accounting/Style internals, raw DB rows, storage keys/credentials/URLs and unsupported answers. All reads return detached deeply frozen values. Structural validation checks source/media hashes, retained definitions, font vocabulary, line measurement, safe/reserved boxes, non-overlap, complete section reconstruction and ordered card slots. `validateLayoutForInput` additionally compares the whole deterministic result against the exact immutable source; untrusted/cached layouts must use this boundary.

layoutHash is SHA-256 of stable JSON of the full semantic resolved layout excluding only layoutHash itself. It includes source semantic hashes, template/engine/measurement versions, exact geometry/styles/ordered text/lines/media. It includes no creation timestamp or database identity. Existing content/design/snapshot/approved-media/document-media/render-input hashes are unchanged.

Part 3A chooses ephemeral derivation. No layout tables, migrations, IDs, backfill or artifact writes. Immutable render input and retained engine/template/measurement definitions deterministically recreate the same layout; preview and PDF share that output. Part 4 can pin layoutHash and version identities alongside an artifact or deliberately add immutable persistence later. Reproducibility depends on retaining all referenced implementation versions; changing metrics/meaning in place is prohibited.

### Part 3B and acceptance

Part 3B owns trusted exact asset byte retrieval, digest/length validation, image decoding, actual controlled font binary loading/embedding and production metrics/shaping, reversed imagery transforms, rendering controlled ornaments/backgrounds, PDF bytes/metadata/Unicode validation and preview/PDF parity integration. It must never consult mutable preference/design/Reading state or independently wrap lines. Production metric provider acceptance must compare the shared layout geometry to both consumers, and must not reclassify provisional metrics as exact.

PDF-REAL-01 remains OPEN, now explicitly including real-font metric equivalence and preview/PDF shared-line/page parity. MEDIA-NATIVE-01 and all independent debts remain OPEN; GEMINI-TAROT-01 remains ACCEPTED. No real Gemini calls, artwork import, external fonts/storage, UI, billing, renderer or delivery in Part 3A.

## Part 3B-1 — trusted rendering resources and production measurement

`getProductionDocumentLayout(db, scope, mediaSnapshotId)` derives production geometry after the existing owned immutable render-input lookup. `prepareDocumentRendering` uses the same lookup and **the same Part 3A engine**, then prepares ephemeral verified resources for Part 3B-2. Neither function writes records, creates PDF bytes or accepts client resource/deck/font overrides. The existing `getDocumentLayout` and default pure composer retain provisional compatibility; production callers explicitly use the production service/provider.

### Controlled resources and provenance

Server resources live in `resources/fonts/`, never `public/`. Inter **v4.1** (official `rsms/inter`, commit `e3a3d4c57d5ecc01453a575621882a384c1995a3`) and Source Serif **4.005R** (official `adobe-fonts/source-serif`, commit `2823e993c53fca27c5c8749f529b56a5a7c77b6b`) are pinned. Acquisition used the official release asset endpoints, not mirrors. Each package retains unmodified static Regular/400, SemiBold/600 and Bold/700 TTF files, the exact upstream OFL-1.1 license with copyright/reserved-name notices, and strict `provenance.json`. The manifest records repository/tag/source commit, original archive/path, archive digest, license digest, file length and SHA-256. This records upstream license evidence, not an independent legal opinion. No derivative/rebranded font binaries, variable fonts, implicit optical-size axes, italic or new seller font keys were introduced.

`font-pins.ts` retains manifest SHA-256 identities. The loader validates manifest, license and every binary before use, checks static TTF/PostScript identity/weight/style, and resolves only code-owned packages under the real resource root. Bounded file reads and no-follow opens prevent arbitrary paths/symlink escapes and oversized reads. No caller path, URL or host font resolution exists. Deployed servers must include these exact resources; Next output tracing explicitly includes them. Acquisition is build-time work; loading, tests and rendering preparation require **zero font network access**.

### Measurement identity and capability

New retained provider **production-font-metrics/1** uses **Fontkit 2.0.4**, normal/400 for both historical design font keys. The design contract has no weight selector; the other retained weights are verified registry resources for later explicit typography evolution, not hidden heading substitution. Its strict descriptor includes implementation, capability `latin-ltr/1` and a resourceHash of the exact regular-font metadata. A binary, shaping feature, wrapping or weight-policy change requires a NEW retained measurement version and retention of version 1 resources/code. Never overwrite these pins to reinterpret an old layout.

Measurement uses actual TTF glyphs, glyph advances and ink extents, kerning and OpenType GSUB/GPOS through fixed `latn`, `dflt`, `ltr` shaping and `kern`, `liga`, `clig`, `mark`, `mkmk` features. Source Serif ligatures and combining mark offsets are tested. Glyph runs expose IDs, x/y advances and x/y offsets for the future renderer; it must use those same runs/features. Latin/Turkish precomposed characters and supported combining accents are covered; no Unicode normalization or rewriting occurs. Width is the rounded-up milli-point extent from min(0, ink left) to max(run advance, ink right). The renderer must shift the run origin by negative inkLeft and use the same scale. Baseline is derived from the controlled font's ascent/global ink top; line height is at least its ascent-to-descent/global-ink range, so production geometry does not clip glyphs to provisional template line spacing.

The explicit capability allowlist is LTR Latin through U+1EFF, ASCII printable characters, selected common punctuation/currency and U+0300–036F combining marks attached to Latin bases. Actual font coverage is checked separately. Unsupported glyphs, unsupported scripts (including Arabic/Indic/CJK), emoji, bidi controls, isolated marks and unpaired surrogates fail; no host fallback/substitution. Stacked marks whose shaped ink exceeds the retained vertical range also fail. Fontkit may implement other scripts, but this provider does NOT claim them accepted. Complete world-script shaping and final multilingual PDF output remain PDF-REAL-01 debt.

CR/LF/CRLF remain in exact text spans and carry no glyph width; TAB is four shaped spaces. The future renderer must consume this policy rather than independently interpreting tabs/newlines. Wrapping measures whole shaped word candidates, preserves combining sequences during emergency breaks and preserves every approved text offset. A bounded per-provider width cache changes no semantics and retains at most 1,024 entries/100,000 key characters. No global customer-text cache exists.

`productionReady=true` means BOTH pinned regular resources were byte/license/identity verified, the trusted provider instance performed supported shaping, all text passed capability/glyph/ink checks, and layout geometry/line measurements validated. It does **not** mean PDF output, font embedding or preview/PDF parity has been accepted. Unsupported text fails instead of returning a production-ready approximation.

### One pagination engine and historical compatibility

`controlled-advance/1` implementation, wrapping and resulting geometry are unchanged. Historical provisional layouts still validate and remain productionReady=false. `document-layout/v1` accepts an additional strict production measurement descriptor; no v2, snapshot semantic change, template version change or second paginator is needed. The new provider supplies shaped wrapping and minimum line height through the measurement port. All keep-with-next/continuation/paragraph/footer/card rules still run in the one generic engine. Production text roles may reserve taller lines; the v1 line-height bound allows up to 100 points for production, while provisional validation retains its original 80-point bound. This is explicit provider-scoped capability, not reinterpretation of old metrics.

Layout hashes retain their previous formula and include the entire descriptor/resourceHash. Validating a production layout requires the matching verified provider; absent, forged or mismatched provider instances fail. Cached/untrusted layout preparation recreates the exact layout from the immutable input before consuming resources. Preview must use production geometry from the production service; Part 3B-2 must not independently wrap/paginate text.

### Trusted image byte pipeline

Visible CARD position → frozen media asset evidence → server-owned exact platform asset metadata → `PlatformAssetStorage.read({objectKey,maxBytes})` → exact length/SHA-256 → signature/format verification → strict image inspection and full decode → frozen metadata plus privately retained original bytes. No current Store preference, latest deck, fallback artwork, URL or client object key enters this path. Exact metadata must match UUID/digest/MIME/width/height/byte size; unavailable/unapproved assets fail. The storage port now requires a maxBytes bound that future adapters must enforce while reading, before unbounded buffering. There is still NO production S3 adapter.

Sharp **0.35.5**, already present transitively through Next and now explicitly pinned, uses libvips to inspect/decode PNG/JPEG/WebP only. Magic is checked before decode; SVG/HTML/GIF/other formats are rejected. Declared and decoded MIME/dimensions must match; animated/multipage imagery and non-identity EXIF orientation fail, preventing hidden presentation transformations. Every compressed pixel stream is decoded with warning-level failure, bounded pixels and a 10-second decode timeout; metadata-only success is insufficient. Original bytes are returned without permanent transformation. REVERSED retains the same source asset; Part 3B-2 rotates the artwork 180 degrees.

Bounds: each font ≤2 MiB, six retained font resources; each image ≤25 MiB, dimensions ≤8,192, ≤16 million pixels; ≤10 unique document images; document aggregate ≤64 MiB encoded resources and ≤32 million decoded pixels. Decodes are sequential (RGBA worst case 64 MB per image); decoder intermediates remain subject to the same pixel/time caps. The adapter, host memory and process concurrency still require real storage/deployment acceptance. Aggregate limits are checked before reads/decodes. Imagery OFF causes zero card storage reads while all immutable semantic media remains unchanged.

### Ephemeral resource bundle and errors

`document-render-resources/v1` is a strict detached deeply frozen manifest: layoutHash, exact measurement descriptor, controlled font key/version/style/weight/length/digest, deduplicated frozen asset evidence and ordered visible card position/asset/orientation associations. resourceHash is SHA-256 stableJson of all semantic manifest fields excluding only resourceHash, with no clock, file paths, object keys, credentials, URLs, AI data or DB rows. Exact repeated preparation has the same identity. Bundles are ephemeral verified preparation, not a new database snapshot; durable immutable inputs/resources already supply identity and Part 4 may pin the resourceHash beside an artifact.

Typed arrays cannot be safely deeply frozen. Verified resource objects keep private copied backing buffers and expose `copyBytes()` returning a new detached copy each time. Fonts/images/bundles are minted by trusted factories; unverified clones cannot masquerade as verified instances. Raw manifest validation proves structure/hash, not byte verification; Part 3B-2 must consume the prepared trusted bundle, or reprepare, rather than bless a client manifest.

Explicit failures include missing/unavailable assets/fonts, storage read failure, frozen metadata mismatch, byte-length/digest mismatch, unsupported/spoofed format, decoded dimension mismatch, corrupt image, image/resource/aggregate limits, unsupported style/weight/script/glyph/ink, unknown resource and provider/hash mismatch. No repair, font/artwork fallback or suppression of required content occurs. Authorization precedes font/storage preparation through the existing organization/Store/document parent boundaries; the pure internal preparation function is not a client API.

Dependency decision: Fontkit 2.0.4 (MIT) supplies retained OpenType parsing/GSUB/GPOS rather than an ad-hoc TTF parser, browser canvas, host APIs or a PDF renderer. Sharp 0.35.5 (Apache-2.0; native libvips dependency with its own notices) supplies full bounded raster decode rather than trusting headers. Both are mature scoped packages with lockfile pinning and no runtime network requirement; no renderer/headless-browser dependency was added. Native codec behavior still needs final intended deployment acceptance.

### Part 3B-2 handoff and acceptance

Part 3B-2 consumes `document-layout/v1` + verified ephemeral resources, embeds exact controlled font bytes, renders identical shaped glyph runs/baselines/line spans at resolved geometry, paints original verified card bytes, applies reversed rotation, implements geometric decorations/footer/page numbers, and produces validated deterministic PDF bytes/metadata. It must prove long-content, Unicode, rendering failures, representative visual fixtures and preview/PDF page/line parity. No PDF bytes or renderer were implemented here.

PDF-REAL-01, TAROT-ASSETS-01 and STORAGE-REAL-01 stay OPEN. Font packages and production measurement are implementation prerequisites only. Real tarot rights/78-card mapping/storage availability and native PostgreSQL acceptance remain independent. No Generation/Review change, real Gemini call, real artwork, UI, billing, delivery or migration/schema change is included.
