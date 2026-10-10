# Milestone 5.1 — Etsy catalog foundation

## Boundary

An Etsy Listing is not a Reading OS Product. Catalog evidence, exact purchase choices, configuration publication, and purchased snapshots remain distinct. This milestone adds manual catalog infrastructure and minimal existing-screen wiring, not the approved Products UI redesign or Store Setup Guide.

No production migration, real Etsy catalog request, OAuth reconnect, AI dispatch, queue mutation or live import was performed during implementation. Fixture/PGlite acceptance is not live Etsy acceptance.

## Source contracts

Official reference: https://developer.etsy.com/documentation/reference (reviewed 2026-10-10).

- GET `/v3/application/shops/{shop_id}/sections`: `count`/`results`, section ID, title, rank and active listing count. Shop identity comes from the owned request path; the section payload does not need an invented shop ID. Complete response required before sections are retired.
- GET `/v3/application/shops/{shop_id}/listings`: explicit `active`, `inactive`, `sold_out`, `draft`, `expired` scans, `limit=100`, offset, creation ordering and `includes=Images`.
- Existing listing/inventory/personalization reader supplies exact `etsy-selection/1:` identities. SKU and display labels never determine identity. Its existing conservative supported-question/scale/availability rules are retained.

Same existing v3 authenticated GET headers, encrypted grants, `listings_r`, token refresh and connection epoch fences; no new OAuth client or write scope. All bodies are bounded to 1 MiB and requests time out after 15 seconds. Unsupported/malformed contracts fail closed. Real app access and current live response compatibility remain unverified.

## Additive schema

`catalog_sections`: store-owned section identity, owned shop ID, title, rank, source active count, verified timestamp and soft presence. Rename/reorder updates retain identity; removal never deletes products or section history. Referenced-but-unavailable section stubs retain only verified identity; title/rank/count/section verification are null, not fabricated.

`listing_catalog`: owned FK to existing listing; safe public thumbnail reference, source Etsy URL, source creation timestamp, relationship state and last verified timestamp, metadata verification time and scan marker. The relationship is `KNOWN`, `UNCATEGORIZED`, `UNKNOWN` or `MISSING`. No source section field means UNKNOWN for new records. Explicit source null/zero means verified UNCATEGORIZED. Failed refresh preserves last-known relationships and their older verification time; sync status discloses the failure. A retired/referenced-unavailable section is MISSING, never assigned a guessed replacement.

The same row retains a bounded current `etsy-setup-catalog/v1` observation, source listing revision, successful and attempted choice timestamps and safe failure code. Old valid evidence survives failure, but counts become UNKNOWN until a successful matching-revision refresh.

`catalog_sync`: one row per owned Store, shop/epoch, manual cycle ID, fenced expiring claim, resumable cursor, attempt/success/section verification times, processed count, unresolved failure count and at most ten safe issue codes. Status: NOT_SYNCED (also the no-row projection), IN_PROGRESS, SUCCEEDED, PARTIAL, FAILED.

Composite ownership FKs/uniqueness and store/state/title/section/scan indexes supplement persisted membership checks. Migration `0026_red_joseph.sql` and generated snapshot/journal are additive. Historical orders, fingerprints, Product Versions and document snapshots are not rewritten.

Description, listing price/currency, full inventory and SKU are intentionally not added: the present UI foundation needs identity, image, status, sections and exact configuration choices. Receipt totals remain unrelated historical finance evidence.

## Manual synchronization

`syncCatalog(db, scope, {pages, choices, restart})` authorizes a persisted owner, resolves the Store/connection server-side, claims the Store under a short transaction, then performs sequential external reads outside transactions. Each publish rechecks membership, shop, epoch and claim.

A request handles 1–5 listing pages and 1–20 choice observations (defaults: five pages, ten choices). A cycle caps listing observations at 10,000 and sections at 1,000; each inventory observation caps choices at 100 and JSON at 256 KiB. It does not accumulate the entire external catalog in memory. The 30-minute lease exceeds the maximum bounded network request duration of a batch; stale publishers are fenced out.

PARTIAL + `hasMore=true` means another explicit click/request is required. It is not a scheduled job. Resume retains durable cursor progress. Failure before a page checkpoint replays that page idempotently. Per-listing failures retain last-good data and are disclosed; retry a completed partial cycle to begin a fresh scan. Explicit `restart=true` abandons the previous cursor, not its persisted catalog/configuration.

429 stops the batch, returns safe Retry-After guidance, and checkpoints previous work. There is no hidden retry loop; the caller must wait for that interval before explicitly resuming. Expired tokens use the existing refresh boundary. Ambiguous refresh/authorization errors require existing reconnect handling. Database publication failures roll back that batch.

Complete section responses alone retire absent sections. Listing records are never deleted; `present=false` means not observed in the latest completed enumeration, not proof of Etsy deletion. Offset pagination is not an Etsy point-in-time snapshot; concurrent source changes remain a limitation. Last-known listing/product data stays accessible. SUCCEEDED is written only after sections, all listing states and all selected inventory observations complete without unresolved transport failures. Supported BLOCKED inventory is recorded as partial coverage, never fabricated as complete configuration.

### Explicit entry points

- Existing Products screen: **Sync Etsy catalog**, owner-only. A continuation message requires another click. No automatic calls on GET/render.
- Existing onboarding retry action can run the same service and advance the existing product-selection step after persisted catalog progress. Cached picker/Setup rendering never calls discovery/OAuth refresh. The legacy picker retains its existing local pagination with a bounded 10,000 lightweight cached-row ceiling.
- `POST /api/catalog`: authenticated persisted owner, same-origin enforcement, JSON body <=1 KiB. No client Store/org identity accepted. Submit `{}` to start/resume, or `{ "restart": true }` for a fresh cycle. Read status before starting another batch. Serverless deployments need a runtime capable of the bounded sequential request duration; no worker is introduced.
- Controlled developer command (do not run against production without separate operational authorization):

```sh
pnpm exec tsx --env-file=.env.local scripts/etsy-catalog.ts OWNER_USER_ID STORE_UUID
# Optional final argument: restart
```

The command verifies persisted ownership; IDs are not authorization. No automatic loop/backfill. Never run it with the real MysticReadingHouse environment as part of this milestone.

## Bounded UI contract

`readCatalog(db, scope, query)` / authenticated `GET /api/catalog` expose `etsy-catalog/v1`:

- Listing identity/title/state, optional source URL/thumbnail/creation timestamp.
- Section ID/title/state/verification time and deterministically ranked section navigation data.
- Coverage state, reliable counts or null, known choices, missing choice reasons and authorized-workflow setup links.
- Associated Product PDF summaries, PRODUCT versus STORE_DEFAULT source, multiple-design indication and UNKNOWN/UNAVAILABLE state.
- Safe sync status, timestamps, hasMore, processed count, failures and bounded issue codes.
- Page, page size, total matching count and deterministic sort.

Query: `page` >=1, `pageSize` <=50, escaped title search, state (`all` default), section (`all`, exact ID, `uncategorized`, `unknown`, `missing`), sort (`title_asc`, `title_desc`, `updated_desc`), optional exact `listingId`. No external HTTP or image download. DB filtering/count/pagination precedes current-page configuration batches. No historical line-item/order reads. At most 1,000 mappings per page; excess returns explicit UNKNOWN configuration summary instead of unbounded loading. Product versions are restricted to current-page owned ACTIVE/DRAFT candidates. Designs are fetched only for those Products plus the Store default. Substring title search is store-scoped; indexes support scope/state/order, not a new full-text search service.

Legacy `catalogData` remains available to existing configuration screens; the new contract is the foundation for the subsequent Products UI. The existing operational card list uses `catalogPageData`: 50 listings per page, current-page mappings/ACTIVE-DRAFT versions and at most 1,000 historical lines, with minimal Previous/Next links. Historical options in its existing advanced section are not presented as current inventory coverage. The final operational table is not implemented.

## Coverage and PDF semantics

Only persisted, successfully verified, matching-source-revision current inventory provides complete counts. Missing, failed or unsupported inventory yields UNKNOWN/PARTIAL and null counts, never 0/0. Historical purchase options and a default mapping are not substituted.

A configured choice requires the exact owned mapping, an owned current ACTIVE Product Version, existing configuration validation and the exact published Etsy listing/selection policy. Draft-only and missing mappings remain separate actionable states. Paused is disclosed separately; configuration coverage is not a new production-readiness/admission status. Two choices referencing the same Product are not automatically both configured if its published policy matches only one.

PDF summary deduplicates associated Products and validates existing design contracts. Product-specific assignment precedes Store default. An invalid explicit assignment does not silently fall back. A valid Store default is never called missing. Missing Product associations/unknown coverage make the aggregate UNKNOWN while retaining known per-Product summaries. Renderer, templates, snapshot resolution timing and immutable artifacts are unchanged.

## Limitations / verification

No live Etsy or native PostgreSQL acceptance; PGlite migration/constraint tests are isolated local database verification. No production migration was executed. UI modernization, coverage filters, full Listing Detail and tooltip components remain later milestones. Existing setup activation deliberately retains fresh, explicit owner-command source validation; page navigation is cached only. Non-active/unsupported inventory follows the existing conservative setup rules and is not claimed fully configured. Rate-limit Retry-After is caller guidance, not a scheduled retry. No native PostgreSQL deployment/performance or live concurrent-source pagination guarantee is claimed.

## Local validation — 2026-10-10

- Node 22.23.1; repository pnpm scripts.
- Full final unit/regression suite: 85 files / 888 tests passed; final relevant suite: 5 files / 23 tests passed.
- Full database regression: 26 files / 510 tests passed on isolated PGlite; final catalog suite after schema/claim refinements: 15 tests passed. Native PostgreSQL deployment/acceptance was not performed.
- Typecheck and production build passed. Final build used process-local `NEXT_TELEMETRY_DISABLED=1`; no environment files were changed.
- No lint script or lint dependency is configured in package.json; lint not run.
- Diff checks passed. Build-generated next-env.d.ts/tsconfig.json noise is excluded/restored.
- Browser acceptance, real Etsy transport, production migrations and production deployment: NOT VERIFIED / NOT RUN.

## Changed files

- `README.md`
- `docs/ETSY_CATALOG_MILESTONE5_1.md`
- `docs/ETSY_INTEGRATION.md`
- `drizzle/0026_red_joseph.sql`
- `drizzle/meta/0026_snapshot.json`
- `drizzle/meta/_journal.json`
- `scripts/etsy-catalog.ts`
- `src/app/(operations)/products/page.tsx`
- `src/app/api/catalog/route.ts`
- `src/app/onboarding/actions.ts`
- `src/app/onboarding/products/page.tsx`
- `src/app/onboarding/products/setup/page.tsx`
- `src/components/products/setup.tsx`
- `src/db/schema.ts`
- `src/modules/catalog/actions.ts`
- `src/modules/catalog/evidence.ts`
- `src/modules/catalog/read.ts`
- `src/modules/catalog/sync.ts`
- `src/modules/catalog/transport.ts`
- `src/modules/etsy/setup-catalog.ts`
- `src/modules/onboarding/discovery.ts`
- `src/modules/onboarding/service.ts`
- `src/modules/products/etsy-setup.ts`
- `src/modules/products/service.ts`
- `tests/catalog-api.test.ts`
- `tests/catalog.db.test.ts`
- `tests/catalog.test.ts`
- `tests/product-pdf-navigation.test.ts`
- `tests/product-picker.test.ts`
- `tests/product-setup-route.test.ts`

## Products List continuation — Milestone 5.2

The operational Products page now consumes `readCatalog` directly. The additive v1 contract includes global `setup` filtering before pagination, saved-catalog section aggregates, bounded existing-operation summaries and a safe live-claim boolean for manual sync controls. Legacy `catalogPageData` remains available to its existing consumers but no longer powers `/products`. See [Products List behavior and acceptance](PRODUCTS_LIST_MILESTONE5_2.md).
