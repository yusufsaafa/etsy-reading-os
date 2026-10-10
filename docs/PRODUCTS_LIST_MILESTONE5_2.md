# Milestone 5.2 — Products List UX

## Implemented

`/products` now uses the cached `etsy-catalog/v1` projection rather than the legacy historical-line card adapter. The page hierarchy is Products header → ranked Shop Sections → search/filters/sort → operational table (stacked records on narrow content widths) → pagination → compact catalog status.

- All Products includes all persisted Etsy states. Active, Draft, Inactive, Sold Out and Expired remain selectable; configuration is never removed by a status filter.
- Horizontal sections preserve Etsy titles and rank. More Sections includes overflow, verified Uncategorized, Unknown and Missing relationships. On narrow screens it includes every section. Selected sections remain identified in the overflow trigger and menu.
- A store-scoped SQL GROUP BY supplies saved catalog counts without loading listings into memory. Navigation counts cover all cached listing states, independent of the search/result filters. They are explicitly **not complete Etsy shop counts**; Etsy-reported active section counts remain separate source data. Partial synchronization can leave imported coverage incomplete.
- GET search/filter controls preserve `search`, `section`, `state`, `setup`, `sort` and `pageSize` in the URL. Apply resets page to one; search has an accessible clear link. Matching counts, sorting and pagination happen in the database, not over a returned page. Query values are individually validated; malformed values fall back safely. Out-of-range pages are clamped for presentation. Page size remains bounded to 50; ties use listing identity.
- Desktop columns: Product, Etsy status, Setup coverage, PDF appearance, Action. Optional persisted thumbnail references render lazily, with an SVG fallback for missing/broken images. No thumbnail is fetched by the catalog server read. Listing titles wrap without hiding the only accessible copy.

## Global setup filtering

`catalogQuery.setup` supports `all`, `full`, `partial`, `none`, `review`. `coverageFilter` runs before LIMIT/OFFSET and matching COUNT, over current persisted choice observations only. Successfully interpreted READY inventory with a matching source revision and no refresh error is required for numeric coverage. Unsupported, missing, failed and stale observations fall into review, never fabricated 0/0.

Exact owned mapping → owned Product → current immutable ACTIVE Product Version → exact Etsy listing/selection policy determines configuration. The SQL predicate uses ProductService's existing validated-publication invariant and the same sorted string-set identity as `selectionKey`; no new readiness status or publication rule is introduced. Draft-only versions do not count; paused mappings still count as configured. A legacy default or historical purchased choice never substitutes for current inventory. Multiple bindings to a shared Product only count when its published policy matches the exact option.

The existing per-page 1,000 mapping summary budget remains. When exceeded, the returned presentation explicitly reports UNKNOWN rather than invented counts; global filtering still evaluates persisted exact bindings in SQL. This is a bounded presentation limit, not evidence of missing setup. No full-history queries, live inventory reads, per-row HTTP or application N+1 queries were added. Store-scoped indexes from 5.1 support catalog scope/state/order and mapping identity; native PostgreSQL execution plans/latency at deployment scale remain unverified.

## Setup warnings and workflow preservation

Incomplete coverage uses restrained amber treatment and the existing `InformationPopover` native top-layer implementation. Its optional hover/focus mode keeps the pointer-accessible panel open across the trigger/panel gap, supports click/keyboard activation, Escape and outside dismissal, and returns focus without reopening during native close. Short titles can differ from unique accessible labels. Viewport-aware positioning and internal scrolling avoid table clipping. Important actions also remain available through explicit controls, including on touch devices.

Verified warnings show actual option labels/states and existing authorized setup routes. Unknown/review coverage explains uncertainty without fabricated missing options. Draft and paused states remain distinct. The per-row management dialog preserves associated Product setup/draft navigation, PDF appearance links and exact-key pause/resume through the existing server actions. It includes saved legacy bindings separately from current inventory claims. No unimplemented Listing Detail links are created. Editing/publishing remain on the existing Product Setup screen.

PDF summaries reuse the existing resolver: Product override first, then Store default. Multiple designs, invalid explicit assignments, missing designs and incomplete associations remain distinct. Invalid overrides never silently fall back. No renderer, template, assignment semantics or immutable snapshot code changed.

## Manual synchronization

Owner-only Sync Etsy Catalog / Continue Sync calls the existing same-origin `POST /api/catalog` after an explicit click. Existing service authorization, lease/epoch fencing, batch bounds and idempotency remain authoritative.

- In-progress disabled/busy state, completed/partial/error feedback and safe connection/rate-limit guidance.
- PARTIAL + hasMore requires another explicit Continue Sync click.
- Retry-After guidance prevents an early repeat click in the current mounted control. There is no automatic retry, next-batch call or background polling.
- Network uncertainty asks the seller to reload recorded status before retrying; no success is invented.
- Server status exposes only whether the existing claim is currently live (`isRunning`), not claim tokens. An expired recorded IN_PROGRESS claim does not permanently disable explicit resumption.
- Last successful/attempted times and safe issue descriptions remain inside compact freshness disclosure. A success older than 24 hours receives a neutral “Catalog may be outdated” hint, not a claim that Etsy data changed.

No sync, external Etsy call, database migration or production operation was performed during implementation/browser acceptance.

## Authorization and boundaries

The page resolves its authenticated persisted store scope on the server. Catalog reads retain organization/store isolation. Only persisted owners see active configuration/sync controls; read-only members see read-only records and evidence. Existing server actions/API checks still authorize each write; UI visibility is not authorization. No client-supplied store identity, tokens, raw provider responses or secrets enter the page DTO.

Order snapshots, purchase fingerprints, Reading identities, Product Versions, generation admission, PDF snapshots, OAuth and sync internals remain unchanged. Listing Detail, Product Setup redesign, Store Setup Guide and automatic sync remain excluded. No dependency/library/schema/migration was added. Icons are the existing monochrome SVG system; the shared disclosure's old Unicode information icon was replaced by an existing SVG.

## Validation and acceptance

Validation results are recorded after final checks below. Database tests use isolated PGlite and migrations, not the application's `.env.local` database. Browser acceptance uses the actual components/styles/application frame in a temporary local fixture harness with mocked navigation/actions/sync transport; it cannot call production endpoints or Etsy. This verifies rendered layout and disclosure interaction, not authenticated deployed end-to-end workflows.

Known limits: live Etsy/current app authorization, native PostgreSQL performance/concurrency, deployed authenticated browser workflows and exact visual comparison against the approved Figma file are NOT VERIFIED. Figma was available but its reference document remained in a loading state. Missing/unsupported current inventory remains explicitly unknown; synchronization is manual and cached data does not imply live availability.

### Final local results — 2026-10-10

- `pnpm test`: **86 files / 900 tests passed**.
- `pnpm test:db`: **26 files / 515 tests passed**, isolated PGlite. Final catalog suite, including the expanded zero-property choice case: **18 tests passed**.
- Final focused catalog/API/Products/navigation/disclosure suite: **33 tests passed**.
- `pnpm typecheck`: passed, including after restoring verified build-generated tooling noise.
- `NEXT_TELEMETRY_DISABLED=1 pnpm build`: passed with Node 22.23.1. Lint is not configured (no script/dependency).
- `git diff --check`: passed. `next-env.d.ts` and `tsconfig.json` are excluded and restored to their verified starting contents.
- **BROWSER ACCEPTANCE: VERIFIED FOR ISOLATED FIXTURES** at 1440×1000, 768×1024 and 390×844. Actual rendered components/application frame/styles were inspected; mobile/tablet layout, long titles, overflow section menu, setup warning keyboard/tap/Escape/outside dismissal, management dialog and mocked rate-limit feedback were exercised. Read-only DOM measurements showed no horizontal overflow. Final warning activation/close produced no browser runtime errors.
- Native PostgreSQL, authenticated production end-to-end workflows, live Etsy transport and exact Figma comparison: **NOT VERIFIED**. No live synchronization, production migration, AI dispatch, push or deployment occurred.

### Changed files

- `README.md`
- `docs/PRODUCTS_LIST_MILESTONE5_2.md`
- `docs/ETSY_CATALOG_MILESTONE5_1.md`
- `docs/screenshots/products-list-5-2-desktop.jpg`
- `docs/screenshots/products-list-5-2-mobile.jpg`
- `docs/screenshots/products-list-5-2-tablet.jpg`
- `docs/screenshots/products-list-5-2-warning.jpg`
- `src/app/(operations)/products/page.tsx`
- `src/components/information-popover.tsx`
- `src/components/products/catalog-list.module.css`
- `src/components/products/catalog-list.tsx`
- `src/components/products/catalog-sync.tsx`
- `src/components/products/catalog-thumbnail.tsx`
- `src/modules/catalog/coverage-filter.ts`
- `src/modules/catalog/query.ts`
- `src/modules/catalog/read.ts`
- `tests/catalog.db.test.ts`
- `tests/fixtures/products-list.ts`
- `tests/information-popover-interaction.test.ts`
- `tests/product-pdf-navigation.test.ts`
- `tests/products-list.test.ts`

## Listing Detail continuation — Milestone 5.3

The listing title and primary Open action now navigate to the implemented listing workspace and preserve validated list URL context. The existing management dialog and direct setup/draft/PDF/pause/resume workflows remain available. Read-only members can open listing evidence without receiving owner-only configuration controls. See [Listing Detail](LISTING_DETAIL_MILESTONE5_3.md).
