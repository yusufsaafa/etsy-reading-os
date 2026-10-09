# PDF Design Studio integration

Starting HEAD: `460763364acfd6e9bfa297d3138a8e0a5a49de47`. Branch: `codex/ui-ux-design-lock`.

## Outcome and acceptance boundary

Reading OS now has an authenticated, Store-owner PDF Design Studio at **`/settings/pdf-design`**, reachable from Settings and existing Product PDF appearance pages. Controls render actual synthetic PDF bytes through the existing deterministic pipeline. Saves use existing DocumentDesign commands; assignment remains separate and explicit.

**Functional implementation and automated acceptance pass. Interactive browser/viewport acceptance is NOT VERIFIED.** The six available families are controlled adaptations, not pixel-identical reproductions of all twelve premium source families. Logo upload remains unsupported and is explicitly disclosed. Do not represent this as full real-Store or customer-PDF acceptance.

No real Store configuration, ProductVersion, Etsy grant, order, Reading, generation, approved document or stored artifact was changed. No Etsy/provider request, customer PDF, delivery, migration, dependency, push or deployment occurred. Actual PDF tests and visual inspection used synthetic content only. Temporary inspection files are not application artifacts and are excluded from git. Known generated `next-env.d.ts` and `tsconfig.json` changes remain preserved and uncommitted.

## Reference analysis

All three owner-supplied Desktop screenshots (`Ekran Resmi 2026-10-09 02.07.43`, `02.07.49`, `02.07.51`) were visually inspected. The supplied **Premium PDF Document System.zip** was inspected directly, without executing or copying its application into Reading OS.

The screenshots establish a light merchant workspace: compact control cards on the left, a large document preview on the right, template tiles, brand colors, controlled typography, cover/display choices, template name, save actions and assignment navigation. The Studio reuses Reading OS's existing shells, tokens, borders, typography and buttons. Desktop columns become one column below 800px; controls further stack below 440px. No new global theme or onboarding shell.

The ZIP is a static React/Vite CSS showcase, not a persisted editor or PDF renderer. Its twelve families use browser typography, decorative CSS/SVG and illustrative tarot content. Useful concepts are page hierarchy, ivory/parchment surfaces, restrained accents, editorial titles, section rules, gallery spacing and continuation pages. Its remote web fonts, fictitious readers and decorative card artwork were not copied into production resources.

### Template compatibility

| Supplied family | Studio family / retained template | Working deterministic adaptation | Limitations |
|---|---|---|---|
| Classic Ivory | Classic Ivory / `classic` v1 | Ivory, editorial typography, restrained frame and section rules | Controlled font substitution; source-specific asymmetric composition is not reproduced |
| Mystic Parchment | Mystic Parchment / `mystic` v1 | Parchment, double frame and celestial rule | No texture/noise/background artwork |
| Minimal | Minimal / `minimal` v1 | White pages, clean typography, generous margins | No card imagery |
| Modern | Modern / `modern` v1 | White pages, sans-serif preset and accent rules | No source CSS decorative circles; no card imagery |
| Luxury Editorial | Luxury Editorial / `luxury-editorial` v1 | Large titles, inset text, editorial ornament/rules | Source Serif substitutes for Bodoni; no browser-only compositions |
| Tarot Atelier | Tarot Atelier / `tarot-atelier` v1 | Gallery-oriented retained layout; approved cards when present | No fabricated card art; NONE-media readings remain text-only |
| Midnight Mystic | Unavailable | — | Needs a separately versioned, verified layout |
| Romantic | Unavailable | — | Not offered as a functional template |
| Celestial | Unavailable | — | Not offered as a functional template |
| Botanical | Unavailable | — | No approved botanical resource integration |
| Gothic | Unavailable | — | Not offered as a functional template |
| Soft Spiritual | Unavailable | — | Not offered as a functional template |

The six preset palettes follow the supplied source concepts. Selecting another layout preserves deliberate owner colors/fonts and other settings; **Apply template colors & fonts** explicitly applies that family's palette and controlled font preset. Unsupported card imagery is cleared when selecting Minimal/Modern. Template tiles are schematic selectors; the adjacent actual PDF is the authoritative preview.

## UI and application boundaries

- `src/app/(store-setup)/settings/pdf-design/page.tsx`: authenticated owner loader; existing shells support incomplete onboarding as well as operations. Selected design UUIDs are validated and resolved through Store-owned reads; foreign/archived designs fail closed.
- `src/components/documents/design-studio.tsx`: left controls/right sticky preview, existing saved designs, explicit saves, loading/errors/retry, native PDF page/zoom controls and new-tab assignment links. Unsaved edits stay local; full-page exits use the browser's unsaved-work warning. No autosave.
- `src/modules/documents/studio-templates.ts`: presentation presets for existing six versioned templates; no competing template schema or renderer.
- `src/modules/documents/service.ts`: owner-only assignment navigation projection; no customer/Reading queries. Existing create/update/assignment services are unchanged.
- `/products/[id]/document-design`: existing owned assignment form and configuration inspection remain. The earlier small creation form is replaced by Studio navigation. The earlier authorized creation action remains compatible; it still uses the existing validated command.
- Settings links to the Studio; no competing application navigation.

### Supported controls and real effects

| Control | Existing canonical setting | Actual rendering behavior |
|---|---|---|
| Template | `template`, retained v1 layout | Page geometry, background, frame, title sizes, ornament, margins and card layout |
| Brand/studio name | `brand.name` | Brand cover text; does not rename the approved reader attribution |
| Primary color | `brand.primaryColor` | Approved text color |
| Accent color | `brand.accentColor` | Supported rules/dividers and ornaments; fixed background/frame colors remain template-owned |
| Heading/body fonts | `typography.heading/body` | Actual embedded Inter / Source Serif 4, shaping, measurement, wrapping and PDF glyphs |
| Brand/simple cover | `cover` | Includes/omits brand heading; approved title and attribution remain trusted snapshot data |
| Customer name | `display.customerName` | Uses approved document customer name; no inference or invented real names |
| Approval date | `display.readingDate` | Uses approved snapshot `approvedAt`, not purchase date or an invented reading date |
| Section dividers | `display.sectionDividers` | Section rule visibility |
| Approved tarot cards | `display.cardImagery` | Only renders existing approved media; cannot create/require cards; unsupported layouts disable this control |
| Footer text visibility/text | `display.footer`, `footerText` | Bounded plain-text footer and its pagination space; page numbers remain visible |
| Template name | existing design `name` | Owner library identity; not a customer-facing product title |

Logo upload is not presented as a working control: the existing resource contract resolves approved tarot assets and controlled fonts, but has no versioned logo asset binding/layout primitive. Accepting an arbitrary file/URL would bypass those contracts. The Brand disclosure explains this blocker. No HTML, custom CSS, executable SVG, browser-only font or remote resource input is accepted. Supporting logos later requires a bounded Store-owned logo resource and versioned snapshot/layout integration; none was fabricated here.

## Preview architecture

`POST /api/document-designs/preview`:

1. Validate the real session, derive the current Store server-side, and require owner membership.
2. Check browser Origin against the actual HTTP Host (not an arbitrary forwarded host). Next's installed server implementation can construct `request.url` using an internal listen hostname. Production requires HTTPS Origin. A route-specific `same-origin` referrer policy keeps Studio server actions/fetches compatible without relaxing global authentication or origin allowlists.
3. Read at most 8,192 request bytes; parse the existing strict design schema. Tenant IDs, source payloads, arbitrary assets and unknown fields are rejected.
4. Admit at most two render operations per process, rechecking after asynchronous body reads to prevent a concurrency race. Busy requests receive a controlled retry response. This is not a distributed rate limiter.
5. Build a fixed synthetic immutable snapshot and NONE-media render input entirely in memory.
6. Load controlled fonts → production font measurement → existing `composeDocumentLayout` → verified `prepareLayoutResources` → existing `renderDocumentPdf`.
7. Return PDF bytes with private/no-store, nosniff, fixed inline filename and bounded page count. No object key, filesystem path, customer content or raw errors.

The client debounces changes by 550ms, aborts/discards stale responses and releases old blob URLs. A native PDF iframe displays the actual returned bytes; page, fit and percentage zoom controls set PDF viewer parameters. A new-tab preview action provides native viewer fallback. Browser support for fragment page/zoom commands varies, particularly on mobile, and remains a manual acceptance item.

Preview does not query a Reading, persist a design, create domain records, upload artifacts or call AI. Fixed example customer/attribution/date are explicitly illustrative and do not assign an actual reader or customer. The synthetic sample spans six pages for every preset and exercises long paragraphs and continuation headings.

## Persistence, revisioning and immutability

`saveStudioDesign` validates bounded configuration, name, intent, owned design identity and expected revision, then delegates to **`createDocumentDesign`** or **`updateDocumentDesign`**. Store ownership is revalidated inside existing transactional commands.

- **Save changes** creates an explicitly approved ACTIVE design when new, or updates the expected revision when existing. The existing contract has no separate design draft/publication phase.
- **Save as template** creates another Store-owned design, never changes an assignment.
- Conflicting revisions retain unsaved controls and return a safe reload instruction. Identical updates use existing no-op semantics.
- Creation remains the existing deliberate non-idempotent create command. Interrupted creation must be reconciled against saved designs before repetition; no automatic retry is performed. Assignment is separately replay-safe.
- Existing prepared documents keep exact immutable snapshot configuration/revision. Editing or assigning affects future snapshot resolution, not previously generated documents.
- Product assignment is still the existing explicit `/products/[id]/document-design` action. Creating/saving a design never assigns it and never changes ProductVersions.

**No design schema, retained template semantics, renderer, storage schema or migration changed.** Existing rendering already supports the offered settings. Connecting it avoids silently altering legacy deterministic output. Resource ownership, font hashes, glyph validation, pagination validation and artifact integrity remain intact.

## Validation evidence

- **164 unit/render/route tests across 10 files PASS**: all six actual template PDFs, deterministic repeat bytes, preview/final pipeline equality, multi-page continuation, color/font/cover/display/footer effects, NONE-media behavior, strict unsupported input rejection, controlled resources/fonts, legacy layouts, authorized download, owner UI/actions, origin/Host checks and concurrent preview bounds.
- **21 isolated DB tests across 2 files PASS**: owner/cross-tenant/sibling Store isolation, explicit create/copy/revision conflicts, assignment separation/replay, missing design, retained immutable snapshots after edit/reassignment/archive and no unrelated production records. Disposable PGlite databases apply the repository migrations; no real local DB migration or setup action.
- `pnpm typecheck`: PASS. Production `pnpm build` (`next build --webpack`): PASS. `git diff --check`: PASS.
- Temporary actual PDF bytes were rasterized with macOS `sips` and visually inspected: all six covers, Classic body/continuation and Mystic body. Readable fonts, section rules, margins, attribution/date and page numbers; no observed clipping/overlap in inspected pages. Geometry/coverage/resource checks cover all generated pages. This is synthetic PDF evidence, not real customer acceptance.
- Initial fixture failures were corrected: too-short continuation content, line-wrap-aware text assertions and the repository's `.test.ts` inclusion pattern. No renderer constraint was weakened.

### Browser limitation and remaining manual checks

Interactive acceptance is **NOT VERIFIED**. An isolated headless Chrome attempt exited 134. The in-app browser rejected the local-file visual fixture under its URL security policy; no bypass or alternative browser workaround was attempted. Static React output and responsive CSS assertions do not prove rendered Studio layout or native-viewer interactions. No Safari automation was restarted.

Owner/manual acceptance should verify the authenticated application at 1440, 1024, 768 and 390px: left/right layout, selection/focus, long saved design/product names, narrow controls, no horizontal overflow, debounce/error recovery, native page/zoom/fit behavior and new-tab fallback. Save/reopen/assignment can be checked with an explicitly authorized disposable owner design; this milestone performed no real Store writes. Then separately review any real Store design before saving/assigning it.

## Exact owner setup steps

1. Sign in normally to your Store. Open **Settings → PDF design**, or **Product setup → PDF appearance → Open PDF Design Studio** before onboarding completion.
2. Start a new design or open an owned saved design. Choose an available layout; optionally explicitly apply its palette/fonts.
3. Set approved studio name, colors, controlled fonts, cover and display choices. Review all synthetic preview pages. Do not mistake example attribution/customer/date for real product metadata.
4. Name the design and explicitly **Save changes**. This approves/creates the design. To deliberately create another reusable owned design, use **Save as template**. Inspect saved designs before retrying an interrupted creation.
5. Open **Manage assignment** for the intended Product. Choose the saved ACTIVE design and explicitly **Save design assignment**. Confirm the existing resolver reports DESIGN_READY. Missing assignment/default remains SETUP_REQUIRED.
6. Real product republication, private artifact storage, eligible Reading creation, generation, review approval and customer PDF rendering still require their established setup/authorization. The Studio authorizes none of those operations.

Functional Store configuration is available, with the unsupported features and browser acceptance limits above. This does not close real Etsy E2E, input or cardinality debts, and does not establish production storage durability.
