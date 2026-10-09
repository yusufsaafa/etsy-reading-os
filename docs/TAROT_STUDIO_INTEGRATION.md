# Tarot artwork and PDF Studio integration

Starting HEAD: `d78b229786e71ca6069dd08bfe6a529eacc0e773`. Branch: `codex/ui-ux-design-lock`.

## Outcome and acceptance boundary

The supplied original 78-card deck is imported into the existing local platform registry and resolves through its existing frozen-asset reader. Studio's card toggle now passes three approved deterministic sample cards into the existing renderer. Product PDF appearance uses accessible design choices and Products provides a visible entry point. No renderer, generation, Etsy, ProductVersion, database schema or document snapshot contract was replaced.

Automated and actual PDF inspection acceptance PASS. Authenticated browser acceptance is **NOT VERIFIED**: Chrome's extension reported unavailable request-header policy; native Chrome inspection showed a Cloudflare Tunnel error at the existing application origin. No new tunnel or OAuth configuration was created. Interactive preview updates, native viewer navigation, save/reopen and assignment UI still need owner verification.

## Source audit

Source: owner-supplied `cards.zip`, inspected from the local Desktop. The package manifest retains the ZIP checksum, original filenames, exact card mappings and individual image metadata. The ZIP and temporary extracted/audit/preview files are excluded from git.

- 81 ZIP entries: 78 JPEGs, one directory and two macOS metadata files (80 files total).
- All 78 JPEGs fully decode; 78 distinct SHA-256 hashes, no missing/duplicate/conflicting cards or unreadable images.
- 22 Major Arcana and 56 Minor Arcana. The existing `THE_FOOL` / `ACE_OF_CUPS` etc. catalog is reused; no second identifier scheme.
- Dimensions vary: width 812–860px, height 1412–1459px. Original bytes and aspect ratios are preserved.
- Files are in `cards/`, named `NN-card-name.jpeg`. Major numbering is 00–21; suit numbering is 01–14. Directory and `.DS_Store`/AppleDouble metadata are excluded.
- All 78 images were visually inspected on a labeled contact sheet against canonical identities. Strict package validation also checks canonical filename/index, mapping membership, uniqueness, complete inventory, metadata and mapping hash; full decode/format/dimensions/byte length/hash checks run before CLI publication.

## Owner artwork approval

The owner explicitly designated this supplied deck as approved artwork and requested its import/use in Reading OS. The existing controlled rights record uses APPROVED / LICENSED to record that owner-supplied permission, with this report as evidence reference. It does **not** claim independently verified public-domain status or third-party commercial rights. The original ZIP contains no separate license document; commercial provenance acceptance remains OPEN in TAROT-ASSETS-01. Do not treat this integration as independent legal clearance for distributing these assets in a commercial hosted service.

## Existing registry and storage

`resources/platform/tarot/rider-waite/manifest.json` is the checked-in provisioning package, not an alternative runtime registry. `resources/platform/tarot/rider-waite/1/` contains 78 unchanged JPEGs named by content checksum. Authoritative records remain `platform_assets`, `tarot_decks`, `tarot_deck_versions` and their existing immutable constraints. Deck identity is `rider-waite`, exact published version 1.

`platformMediaRegistry.importApprovedDeck` validates the complete package, serializes on the existing deck row and inserts through existing tables in one transaction. Identical replay is a no-op; conflicting existing evidence throws and rolls back. Asset identity is deterministically pinned to deck/version/card/content; unique object keys and existing SQL immutability prevent overwrites. No Store preference is set. No customer-facing asset import route exists.

The existing `LocalPlatformAssets` adapter is reused, with a default read-only packaged `resources/` root independent of customer artifact storage. `DOCUMENT_ASSET_ROOT` can explicitly supply another canonical approved root. Traversal, symlinks, URLs and oversized reads fail closed. No browser receives filesystem paths or object keys. Next output tracing includes the approved resources, as it already did for controlled fonts. Production must provision the exact platform registry metadata and retain the packaged images (or supply a compatible trusted platform storage port); no deployment occurred. This is not evidence of durable private customer artifact storage.

Explicit operator/local procedure (Node 22 and project dependencies):

```sh
node --import tsx scripts/import-tarot-deck.ts
node --env-file=.env.local --import tsx scripts/import-tarot-deck.ts --publish
```

The first command verifies all files without DB writes. `--publish` permits only a localhost database URL, verifies every image before mutation, imports the global platform package, then resolves/reads all 78 through the existing resolver. It runs only when invoked; no startup, page-load or discovery provisioning. Executed against the existing local database, then replayed successfully; exact persisted inventory is 78 assets, one deck and one published version. No migrations were needed or applied.

## Real PDF preview

Authenticated owner session → server-derived Store authorization → bounded strict design configuration → preview-only `studioPreviewMedia` → exact published approved registry version → `resolveTarotCardAsset` → synthetic immutable render input → existing layout/resource verification/PDF renderer.

The fixed preview sample is The Fool, The Lovers and The Star, upright in stable order. The only preview deck reference lives in `studio-media.ts`; the renderer remains deck-independent. Visible JPEG bytes are read through `readFrozenPlatformAssetBytes`, checked against registry metadata and fully decoded by existing resource verification. Missing, retired, corrupt or unavailable resources fail with the existing safe retry response; no generated or remote substitute.

ON embeds three original JPEGs in Classic Ivory, Mystic Parchment, Luxury Editorial and Tarot Atelier. OFF uses NONE media, performs no sample resource read, embeds zero images and leaves no card frames. Minimal and Modern remain explicitly text-only, with the card control disabled; retained renderer/template contracts are unchanged. Their lack of card support is not concealed.

Preview samples exist only in ephemeral synthetic input. The preview path creates no Reading, Generation, design, snapshot or artifact and changes no Store preference. Real customer snapshots still accept only cards bound to the approved reading; real NONE-media products remain card-free even when their assigned design permits card imagery.

## Seller workflow and files

- `studio-media.ts`, `studio-preview.ts`, preview route: approved sample composition and existing rendering pipeline.
- `bundled-deck.ts`, `platform-registry.ts`, `scripts/import-tarot-deck.ts`, approved resource package: bounded verified/replay-safe provisioning.
- `document-runtime.ts`, `next.config.ts`: reuse existing asset adapter and deployment tracing; current explicit development-origin fix preserved.
- `design-studio.tsx`: selected template beside New / Saved / Unsaved status, accurate sample-card copy, recoverable errors and bounded 30-second loading timeout. Existing explicit Save changes / Save as template behavior is retained; no autosave or silent assignment.
- `/products/[id]/document-design`: product heading/breadcrumb, current assignment state, Store-owned ACTIVE radio choices, revision/fonts, schematic design swatches, explicit Save design assignment and separate new-tab Studio navigation. Swatches are labeled selectors, not a fake PDF preview.
- `/products`: visible PDF appearance links for existing associated Products, including exact non-default Etsy configurations. Duplicate bindings are deduplicated for navigation; no Product is created to provide a link.
- `globals.css`: compact shared merchant controls, selected/focus states and single-column narrow layout.

Owner procedure: Products → existing product's PDF appearance → Open PDF Design Studio → edit a design and inspect synthetic preview → explicitly Save changes (or Save as template) → return to the Product → select approved design → Save design assignment. Assignment changes future snapshot resolution; prepared documents retain exact configuration/revision. No real Store design or assignment was created/changed by this milestone.

## Validation

- **190 distinct unit/render/route/security tests across 14 files PASS**: 182 focused tests plus eight additional internal-access/runtime tests. Repeated validation of the eight import tests is not double-counted.
- **25 distinct isolated DB tests across three files PASS**: four import/preview authorization/replay/conflict tests and 21 existing design/snapshot tests. Import tests were rerun after strengthening package checks. Disposable PGlite databases apply existing repository migrations; no real Store fixtures are inserted.
- Actual PDF inspection: reopened PDFs contain exactly three `/Image` XObjects with `/DCTDecode`; embedded streams equal the original JPEG bytes. Identical inputs produce identical PDFs. OFF and text-only layouts contain no images; missing bytes fail closed.
- Four seven-page synthetic PDFs were generated through the local persisted asset registry and actual renderer, rasterized with macOS PDFKit, and their gallery pages visually inspected. All three approved cards and labels are visible with preserved ratios and no observed overlap/clipping. Automated geometry/coverage checks cover all pages; interactive browser preview is a separate unverified gate.
- Store/cross-tenant/anonymous/origin/Host authorization tests, internal production-access defaults, exact assignment persistence, concurrent/repeated import, immutable design snapshots and NONE-media safety pass. No package paths/provenance/import code appeared in production static client JavaScript search.
- `pnpm typecheck`, `pnpm build` and `git diff --check`: PASS. An initial readonly test-fixture assignment was corrected; final checks passed.
- No dependency, migration, OAuth change, Etsy operation, real customer operation, generation, PDF delivery, push or deployment.

## Remaining acceptance

1. Restore the existing development origin's availability, then verify authenticated Studio preview/page/zoom, ON/OFF/template updates, retry, save/copy and Product assignment/reload in the browser at desktop/mobile widths. No full browser PASS is claimed.
2. Confirm third-party commercial provenance/rights independently before closing TAROT-ASSETS-01. Actual image/mapping/embedding evidence is now available; rights evidence remains distinct.
3. Provision the exact approved registry and retained artwork in the intended deployment, and separately satisfy private artifact-storage acceptance. Production delivery and real Etsy E2E/input/cardinality debts remain unchanged.
