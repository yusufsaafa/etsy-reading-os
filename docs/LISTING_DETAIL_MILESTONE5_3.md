# Milestone 5.3 — Listing Detail & Purchase Options

## Workspace and navigation

`/products/[listingId]` is a listing-level workspace (the existing Next.js dynamic folder remains `[id]`, shared with the independent UUID Product Setup child route). It does not create or edit a Product on GET.

Products List titles and Open actions now lead to Listing Detail. The existing management dialog still exposes Product Setup/drafts, PDF Appearance and exact-key Pause/Resume. The encoded `returnTo` preserves validated Products search, section, Etsy status, setup coverage, sorting, page and page size. Return destinations are restricted to `/products`; malformed/external/duplicate query parameters are canonicalized or rejected. Direct detail visits return to the default list.

Hierarchy: breadcrumb → compact Etsy listing header → four summary metrics → Purchase Options → compact catalog information. Header preserves full title, persisted thumbnail/SVG fallback, listing ID/state, verified section relationship and catalog verification timestamp. View on Etsy uses only an HTTPS Etsy listing URL matching the selected listing ID; credentials/ports and unrelated hosts/paths are rejected, query parameters removed, and new-tab links use noopener/noreferrer. Persisted thumbnail references are revalidated against the existing Etsy image allowlist; ordinary server reads never download images.

## Evidence and exact choices

`readListingDetail` calls the existing `etsy-catalog/v1` projection with one exact owned listing ID and page size one. Association, active/draft version and PDF resolution queries remain batched. No store listing load, historical-order scan, per-choice DB query, live Etsy call or mutation is introduced. Existing store-level bounded section lookups/SQL count aggregates remain part of the reused projection.

The additive choice projection supplies source display dimensions, owned Product name, association state and active/draft evidence. Canonical `etsy-selection/1` matching and existing validated ACTIVE publication policy remain authoritative. Identical labels never merge choices; SKU, label and position never replace exact identity. Source dimension labels/values remain readable, Unicode is escaped by React, and a zero-property choice is Default purchase option. Missing display labels fall back to actual property/value IDs; a varied choice never becomes a default because labels are unavailable. Exact keys are secondary InformationPopover evidence.

Configured requires the existing exact published configuration rule. Draft-only, missing mapping, disconnected mapping, inconsistent owned association and mismatched publication are separate presentations. A configured paused mapping remains counted and shows Configured · Paused. Shared Product identities are preserved, but sharing does not bypass an exact published-policy mismatch. Actions use the existing owned Product Setup or listing-level option chooser; unmapped choices do not guess or create Product IDs. Product PDF Appearance links reuse existing routes. Operators can read the entire workspace; only owners receive configuration controls. Server-side write authorization is unchanged.

## Summary and uncertainty

Purchase Options and Configured counts appear only for verified current inventory within presentation bounds. Reading OS Products counts distinct associated Products, not choices. PDF Designs counts distinct resolved designs only with reliable association/design evidence; unknown/missing/invalid evidence is Not verified. These counts are configuration coverage, not runtime production readiness.

When inventory is missing, stale, unsupported, failed or partial, the current Purchase Options table is withheld. Previously configured options is a clearly separate bounded saved-mapping list, never a substitute current inventory. Unknown totals are not zero. Existing limits remain 100 current choices, 1,000 mapping summaries and bounded design/section summaries. Mapping overflow is explicit, never claimed complete. A cached setup snapshot whose listing ID differs from the owned listing is rejected in the read projection.

PDF resolution is unchanged: Product assignment, then Store default. Invalid explicit assignments do not fall back. Each owned Product's resolved design is reused for shared choices. No template, renderer, artifact, immutable document snapshot, purchase fingerprint, Reading identity or Product Version pin changes.

Catalog freshness uses persisted successful sync time, inventory verification state and safe issue descriptions in the existing InformationPopover. Refresh navigation returns to Products; continuation remains an explicit owner action there. Opening the workspace performs no sync, polling, OAuth reconnect or AI dispatch.

## Responsive and accessible behavior

Existing application shell, semantic typography/tokens, monochrome SVG icons, buttons and badges are reused. Desktop uses an operational table. Tablet/mobile reflow each option into a record with full-width choice dimensions and compact metadata/action cells. Four summary metrics become a two-by-two grid on phones. Titles and long variation values wrap without hiding the only copy.

Semantic headings, table caption/column headings, named summary definition list, readable textual status, visible existing focus styles and labelled InformationPopover controls remain available. Native top-layer popovers provide keyboard/tap access, Escape/outside dismissal, focus return, viewport positioning and internal scrolling. No informational accordions, extra component/icon library, emoji interface icons or animation were introduced.

## Validation and limitations

Final results are recorded below after verification. Database tests use isolated PGlite with repository migrations, never the configured development database. Browser acceptance uses actual components, styles and application frame with synthetic listing evidence, mocked navigation/actions and blocked API calls. It does not establish authenticated production end-to-end acceptance or live Etsy completeness.

Product Configuration redesign, Readiness workspace, automatic catalog refresh, onboarding guide and Etsy writes are excluded. Existing Product Setup remains the editor. Unverified current inventory stays unverified until an explicit authorized sync outside this implementation. Exact visual comparison to the approved Figma reference is reported separately from fixture browser acceptance.

### Final local verification — 2026-10-10

- Starting repository: `codex/ui-ux-design-lock`, HEAD/base `72965c19baf25e6f715a598faa15ed449df57890`; clean working tree and verified ancestry.
- Full `pnpm test`: **87 files / 913 tests passed**.
- Full database regression command (`pnpm test:db -- tests/catalog.db.test.ts`, which Vitest interpreted as the full configured database suite): **26 files / 519 tests passed**, isolated PGlite. Final explicitly targeted catalog/Listing Detail suite: **24 tests passed**, including the 100-choice constant query-budget test, shared Product setup identity and invalid explicit PDF assignment.
- `pnpm typecheck`: passed. `NEXT_TELEMETRY_DISABLED=1 pnpm build`: passed, including the new dynamic `/products/[id]` route. Lint is not configured.
- `git diff --check`: passed. Verified Next.js-generated `next-env.d.ts`/`tsconfig.json` changes were restored and excluded.
- **BROWSER ACCEPTANCE: VERIFIED FOR ISOLATED FIXTURES**, actual rendered components/application frame at 1440×1000, 768×1024 and 390×844. Full desktop/tablet/mobile screenshots inspected. Long titles/dimension values, incomplete/unknown/default/shared-Product states and read-only controls were exercised. No horizontal page overflow at the tested widths. Keyboard/tap disclosure, Escape/focus return, outside dismissal and mobile viewport collision were checked. List → detail → list preserved combined search/section/status/setup/sort/page-size context. Browser runtime error log was empty at final inspection.
- Figma's open Products Management prototype exposed the expected Listing Detail hierarchy and exact multi-property choices through accessibility inspection. Native screenshots remained on a different prototype view, so **exact Figma Listing Detail visual comparison: NOT VERIFIED**. This is distinct from the inspected implementation fixture screenshots.
- Authenticated deployed end-to-end workflows, live Etsy transport/completeness and native PostgreSQL deployment-scale query plans remain **NOT VERIFIED**. No configured-development-database mutation, live catalog sync, external API call, migration execution, AI dispatch, push or deployment occurred during this milestone.

### Changed files

- `README.md`
- `docs/PRODUCTS_LIST_MILESTONE5_2.md`
- `docs/LISTING_DETAIL_MILESTONE5_3.md`
- `src/app/(operations)/products/[id]/page.tsx`
- `src/components/products/catalog-list.module.css`
- `src/components/products/catalog-list.tsx`
- `src/components/products/listing-detail.module.css`
- `src/components/products/listing-detail.tsx`
- `src/modules/catalog/detail.ts`
- `src/modules/catalog/detail-model.ts`
- `src/modules/catalog/query.ts`
- `src/modules/catalog/read.ts`
- `tests/catalog.db.test.ts`
- `tests/fixtures/products-list.ts`
- `tests/products-list.test.ts`
- `tests/listing-detail.test.ts`
