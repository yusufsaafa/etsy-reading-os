# Product Setup Completion — Milestone 5.6

## Architecture audit before implementation

Base `7bb628cb706f6cf184a7be2fa13ba9a086c23ea3`, branch `codex/ui-ux-design-lock`; clean working tree and ancestry verified.

- `catalog/read.ts` owns bounded catalog pagination, revision-matched inventory, exact association coverage and batched PDF summaries. `coverage-filter.ts` owns global SQL filtering before pagination. These existing configured filters must not be redefined as readiness filters.
- `products/readiness.ts` owns `product-readiness/v1`: independent ACTIVE/DRAFT, authoritative shared publication/setup validators, exact policy matching, PDF evidence and uncertainty aggregation. Runtime availability remains separate.
- `products/readiness-service.ts` reads owned saved association evidence. Global Product associations matter even when only one listing is shown; page-only associations cannot certify a Product.
- `catalog/detail.ts` reuses the catalog projection for one owned listing. Existing workspace-navigation validates return context and keeps Product UUID separate from listing identity.
- `documents/service.ts` owns design resolution; catalog PDF summaries already use the same owned assignment precedence and configuration schema. No rendering is needed.
- `verifyScope` and tenant-scoped queries authorize reads. Writes remain behind existing owner services. Orders uses `/orders`.

Implementation strategy: reuse the pure readiness engine with page-scoped Product/version/PDF data and bounded batched global mappings/current inventory evidence. Unknown/overflow never becomes complete readiness. Catalog coverage and filter semantics stay intact. No schema, external request or mutation is required.

## IMPLEMENTED — projection and exact-choice semantics

`catalog/setup-progress.ts` defines `catalog-setup-progress/v1`, a read-only summary of existing product-readiness/v1 results. It includes state, reliable ready/total counts, paused count, exact canonical choice keys and per-choice states, and a limit flag. NOT_APPLICABLE remains an underlying readiness check (for example TEXT/PDF); a real current choice is never omitted as “not applicable.”

A choice is READY only when the owned Product’s published assessment is READY and its exact `(listingId, etsy-selection/1 key)` evidence passes. A valid draft cannot supply readiness. ACTION_REQUIRED propagates verified published/configuration failures, including PDF resolution failure and exact policy mismatch. NOT_CONNECTED means verified current inventory with no owned Product association. Invalid association is ACTION_REQUIRED. Unknown inventory, absent assessment or bounded evidence remains UNKNOWN; saved historical mappings cannot certify current coverage. Duplicate labels never define identity.

Multiple choices may share a Product; existing exact publication-policy rules still decide each association. No policy is relaxed. Paused mappings can pass configuration assessment but preserve a separate hold in rows, list labels and workspace handoff. No association is changed.

## IMPLEMENTED — listing aggregation and freshness

The denominator requires complete current saved inventory under the existing catalog revision/error/schema checks, current shop provenance and complete presented choices. Stale, failed, unsupported, partial or truncated inventory yields null counts and “Verification needed.” Reliable complete inventory permits Ready counts. NOT_CONNECTED is explicitly labeled. Unknown Product readiness remains “Verification needed,” not a misleading zero-completion status. Verified actionable issues take precedence over other unknown choice states.

No new elapsed-time freshness rule is introduced. This assesses saved catalog evidence; it is not a live Etsy availability check. Coverage filters (`full`, `partial`, `none`, `review`) retain their existing SQL configured semantics before pagination. Ready progress adds assessment of required PDF configuration and current evidence; it does not redefine those filters. The UI discloses this distinction.

## IMPLEMENTED — integration and navigation

- Products List retains its compact table, search, sections, Etsy state, setup coverage filters, sorting, pagination and manual sync. Ready progress replaces only its displayed setup indicator; existing coverage details and management controls remain available.
- Listing Detail retains all variation dimensions, configured metrics and compact rows. Each exact choice shows Ready, Needs attention, Verification needed or Not connected. Existing Products open canonical configuration; corrections open its Readiness tab; unconnected choices use the existing operational Configure entry. Unknown complete inventory still shows the established uncertainty/previously configured section.
- The Product Configuration workspace shows a compact handoff above its tabs. Only saved READY published configuration gets “Configuration ready” and `/orders`. Paused holds and runtime uncertainty are explicit. Draft-only and unknown published evidence prioritize Readiness. After publication a reload is required to assess the new saved snapshot. No second editor or mutation is introduced.
- Existing validated workspace-navigation/Products return paths preserve filters, sort, page and page size. No Product UUID is invented; GET never creates/publishes a Product.

## IMPLEMENTED — performance and authorization

The existing catalog read remains paginated (page size <=50). Only Products referenced by current page mappings are candidates. Assessment is capped at 100 distinct Products, 1000 global Product mappings (1001st detects overflow), 100 associations per assessed Product and at most 1200 related listing evidence rows. Remaining Products/overflow are UNKNOWN rather than claimed complete. Current listing presentation remains capped at 100 choices and discloses larger/partial inventory.

Additional reads are one batch of global mappings for those Products, one batch of their listing evidence and one current Store provenance lookup. Product/version/design rows reuse existing page-scoped batches. No N+1 readiness service calls, store-wide Product scan, order-history scan or external calls occur. Shared savedChoiceObserver was extracted from 5.5 unchanged and validates each related listing once for the batch. The workspace service uses the same observer. PDF assessment reuses existing catalog-owned assignment evidence plus documentDesignSchema/immutableResolvedDesign and hash validation, including explicit invalid override failure. No renderer or artifact pipeline changed.

Every read retains verifyScope and persisted membership, server-resolved Store and tenant predicates. Cross-store Products/designs cannot enter the owned maps. Read-only members can see progress; configuration/sync writes remain behind existing owner services. No credentials or raw provider response are added to this projection. ProductVersion, orders, readings and document snapshots are untouched. No schema changes, DB writes or migrations are introduced.

## TESTED — browser fixtures

Actual ApplicationFrame, ProductsList, ListingDetail and ProductWorkspace components were rendered in an isolated local Vite harness with actual engine-generated serialized fixture assessments. Six representative states (all-ready, mixed, unconnected, unknown, draft-only and paused) were inspected in List and Detail at 1440/768/390px. Published handoff was inspected for ready, unknown, draft and paused at all three widths. A long Unicode variation/title fixture was also inspected at each width. All 51 viewport/state inspections had document width equal to viewport width.

Ordinary desktop six-choice rows measured approximately **69–70px**, without fixed/clipped heights. Long dimensions expanded naturally. Tablet/mobile records retained all dimensions, attached disclosure controls and visible actions. Keyboard Enter activated Go to Orders; Configure retained canonical choice and returnTo; browser Back returned to the preceding workspace/detail. Existing information dialog opened on tap and dismissed with Escape.

Screenshots: [acceptance/milestone5_6](acceptance/milestone5_6/).

| Screen/state | Desktop | Tablet | Mobile |
|---|---|---|---|
| Products all-ready | [Desktop](acceptance/milestone5_6/list-ready-desktop.png) | [Tablet](acceptance/milestone5_6/list-ready-tablet.png) | [Mobile](acceptance/milestone5_6/list-ready-mobile.png) |
| Mixed Listing Detail | [Desktop](acceptance/milestone5_6/detail-mixed-desktop.png) | [Tablet](acceptance/milestone5_6/detail-mixed-tablet.png) | [Mobile](acceptance/milestone5_6/detail-mixed-mobile.png) |
| Configuration handoff | [Desktop](acceptance/milestone5_6/workspace-ready-desktop.png) | [Tablet](acceptance/milestone5_6/workspace-ready-tablet.png) | [Mobile](acceptance/milestone5_6/workspace-ready-mobile.png) |
| Draft-only handoff | [Desktop](acceptance/milestone5_6/workspace-draft-desktop.png) | [Tablet](acceptance/milestone5_6/workspace-draft-tablet.png) | [Mobile](acceptance/milestone5_6/workspace-draft-mobile.png) |

## NOT VERIFIED / limitations

Authenticated real-store acceptance is NOT VERIFIED. Figma was not accessed. The fixture’s Orders and new-setup destinations are navigation-only stubs; no real Product was created/published and no real order was processed. Real route/service behavior remains covered by existing regression tests. PDF assignment fixture content is a stub; real resolver behavior is exercised in isolated DB tests. No live Etsy/AI/storage/rendering/delivery availability is verified or guaranteed.

Readiness is saved configuration assessment and never replaces publication, intake or runtime admission. Large associations/page Products beyond assessment bounds remain unknown. Existing configured filters can include an otherwise published mapping requiring PDF/evidence correction; that distinction is explicit rather than silently changing query semantics.

## Changed files

- `src/modules/catalog/read.ts`, `setup-progress.ts`: bounded page projection.
- `src/modules/products/readiness-evidence.ts`, `readiness-service.ts`: shared evidence observation.
- `src/components/products/catalog-list.tsx`, `listing-detail.tsx`, `configuration-workspace.tsx`, `configuration-workspace.module.css`: compact progress/correction/handoff.
- `tests/setup-progress.test.ts`, `product-readiness.db.test.ts`, `product-workspace.test.ts`: unit, isolated DB and workspace regressions.
- README, this report and 51 local fixture screenshots.

No order intake, generation, publication, PDF renderer, OAuth, sync, schema or migration implementation was changed.

## TESTED — code validation

| Check | Result |
|---|---|
| `pnpm test` | 94 files, **979 tests passed** |
| `pnpm test:db` | 27 files, **533 tests passed**, isolated PGlite with repository migrations |
| `pnpm test:db tests/product-readiness.db.test.ts` | Final focused source: **9 tests passed**, including real resolver/projection consistency |
| `pnpm typecheck` | Passed |
| `NEXT_TELEMETRY_DISABLED=1 pnpm build` | Passed production build |
| `git diff --check` | Passed |
| Lint | No script configured |

New coverage verifies all/mixed/unconnected/unknown/stale progress, ACTIVE/DRAFT separation, exact keys and listing identity, shared mappings/policy mismatch, paused holds, PDF failure, invalid association, owner/member/cross-store scope, no mutation, constant query count across multi-Product page sizes, pagination and unchanged configured filters. Existing Products, catalog, Orders, generation, document and navigation suites remain passing.

Initial validation caught a test import needing the established server-action mock and a redundant typed status comparison; both were fixed. Build-generated tooling diffs were inspected and excluded. No production/development migrations, catalog sync, OAuth reconnect, AI dispatch, push or deployment occurred.
