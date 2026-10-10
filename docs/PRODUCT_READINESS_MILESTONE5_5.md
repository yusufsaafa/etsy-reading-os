# Product Readiness — Milestone 5.5

## Architecture audit (before implementation)

Base: `73c689a122e28d2421e646ad29c2df37a5d7e09d`, `codex/ui-ux-design-lock`. Only inspected Next.js generated tooling changes were restored before implementation.

| Boundary | Existing authority | Assessment reuse |
|---|---|---|
| Version structure and publication | `products/contracts.ts`: configurationSchema, activationErrors; `validation.ts`: configurationIssues | Same schemas and validators, no new mandatory inputs or instruction fields |
| Exact owned bindings and active listing | `products/service.ts`: activateProduct | Extract the existing deterministic binding checks for shared use; preserve explicit owner publication and revision/transaction guards |
| Current Etsy choices and questions | `catalog/evidence.ts`, `catalog/read.ts`: validateCatalogEvidence/currentCoverage; `products/actions.ts` and setupReadiness | Assess saved revision-matched evidence only; publication retains fresh source validation |
| Intake and generation | `products/runtime.ts`, `generation/context.ts` | Remain authoritative; readiness does not admit work or replace order-specific validation |
| PDF appearance | `documents/service.ts`: resolveDocumentDesignForProductInTransaction | Reuse resolver, including invalid explicit override behavior; no rendering/storage |
| Workspace | `products/workspace.ts`, `components/products/configuration-workspace.tsx` | Bounded owned ACTIVE/DRAFT and associations; replace limited Readiness presentation only |

Current configuration permits zero customer fields when no required Etsy input requires mapping, empty section instructions, MANUAL/ASSISTED, TEXT/PDF and optional preparation targets within the existing schema. AUTOMATIC is structurally recognized but publication rejects it. These rules remain unchanged. Published title evidence comes from pinned ProductVersion metadata; mutable Product names must not invalidate an otherwise valid published version. One policy encodes one exact selection; multiple saved mappings must be assessed independently, and a shared Product does not imply every mapped choice matches that policy. Pausing is a separate hold.

Readiness is a read-only assessment over a repeatable-read authorized snapshot. ACTION_REQUIRED takes precedence over UNKNOWN; NOT_APPLICABLE is non-blocking. Published and draft results remain independent. Runtime provider, storage, Etsy availability, future customer answers, generation, rendering and delivery are not tested by this assessment. No external requests, mutation or schema migration are required.

## IMPLEMENTED — assessment contract and targets

`src/modules/products/readiness.ts` defines the pure `product-readiness/v1` contract. It includes authorized Product/Store identities, independent PUBLISHED and DRAFT targets, assessed version IDs/numbers/revisions, stable checks, per-choice evidence, typed remediation, bounded evidence scope and a separate runtime disclaimer. Persisted observation timestamps are retained; no wall-clock assessment timestamp changes an otherwise identical result. Catalog payloads and credentials are not returned.

Check statuses are PASS, ACTION_REQUIRED, UNKNOWN and NOT_APPLICABLE. Overall aggregation is ACTION_REQUIRED if any required check fails, otherwise UNKNOWN if evidence is unknown, otherwise READY. NOT_APPLICABLE is non-blocking. Failure takes precedence over uncertainty. Runtime NOT_VERIFIED is deliberately outside this aggregation.

Missing ACTIVE means published ACTION_REQUIRED even when a valid draft exists. An invalid draft does not invalidate an otherwise eligible ACTIVE version. Missing DRAFT means no saved draft is assessed (contract UNKNOWN, UI “No saved draft”). Unsaved editor values are never substituted for persisted versions. The workspace warns to save if needed and reload after save/publication.

Stable check IDs: `version`, `structure`, `product-setup`, `generation`, `exact-policy`, `etsy-inputs`, `pdf`, `inventory`, `evidence-limit`. Structural checks reuse configurationSchema. Setup/generation checks reuse activationErrors. The existing setupReadiness implementation was moved unchanged into `products/setup-validation.ts` and re-exported for the editor. Existing publication binding checks were extracted unchanged into configurationBindingErrors and reused by activateProduct and assessment. Publication, intake and generation admission remain authoritative.

## IMPLEMENTED — exact choices and freshness

`readProductConfigurationAssessment` authorizes through productWorkspaceData and reads the workspace plus assessment in one repeatable-read transaction. It uses at most 100 saved mappings plus two version-policy identities, one batched tenant-scoped listing/catalog query capped at 102 listings, and one cached evidence interpretation per listing. It performs no history scans, per-choice queries, external requests or writes. Overflow is explicitly UNKNOWN rather than false complete readiness.

Canonical etsy-selection/1 keys remain authoritative. Labels are presentation only. Missing owned mappings are verified failures. Inactive source listings and exact policy mismatches remain failures under existing publication rules. Unknown, stale, unsupported, failed or previous-shop catalog evidence is UNKNOWN. Current means revision-matched cached evidence under the existing catalog rules, not live Etsy availability or a new elapsed-time freshness guarantee. Historical mappings remain intact; no reassociation occurs.

Per-choice evidence remains separate from whole-listing coverage. Multiple choices may reference one Product, but the existing published policy represents one exact selection; distinct nonmatching choices are not incorrectly marked configured. A paused mapping retains its explicit hold without being reclassified as structurally unconfigured. A draft policy’s missing association cannot contaminate an unrelated ACTIVE target.

## IMPLEMENTED — PDF and runtime boundaries

TEXT output makes PDF NOT_APPLICABLE. PDF output uses the existing document resolver once for the owned Product: valid Product override, then valid Store default. Explicit invalid overrides produce ACTION_REQUIRED and never silently fall back. Missing designs fail; unavailable evidence is UNKNOWN. Unselected output directs the seller to Generation Settings.

Design resolution is configuration evidence only. Assessment does not render, create storage objects, rewrite artifacts or alter snapshots. AI/provider availability, object storage, Etsy availability, future customer answers, generation, PDF rendering and delivery remain NOT_VERIFIED. READY does not guarantee future execution.

## IMPLEMENTED — workspace and security

Readiness replaces the limited existing tab inside the canonical Product Configuration workspace. Published, draft and published-choice summaries are distinct. Blocking issues appear first with concise explanations and working remediation links. Remaining checks are grouped under Product Setup, Generation Settings, Etsy Associations and PDF Appearance; per-choice evidence and recorded timestamps are visible. Runtime limitations are separate.

Remediation uses existing configuration tabs, owned Listing Detail and validated Products return paths. No new editor, publication workflow, endpoint, permission or persistence model is introduced. Existing shared draft, optimistic revision checks, explicit publication and PDF assignment semantics remain unchanged. Malformed persisted configuration is assessed visibly; its editor is disabled rather than overwriting the malformed snapshot with defaults.

Persisted membership and server-resolved Store authorization apply to every read. Read-only members can view assessment; no mutation is added. Forged user scope and cross-store Product access are denied. No OAuth tokens, raw credentials or provider secrets enter the assessment.

## TESTED — local browser acceptance

The isolated Vite harness uses actual ApplicationFrame, ProductWorkspace, ProductEditor, ReadinessWorkspace and repository CSS. Actual engine outputs are generated offline and passed as serialized fixture data, as in the server-loaded workspace. No authenticated store, development database or external service is involved. PDF assignment content in this harness is a fixture stub; real design resolution is covered by isolated database tests.

All six representative states were rendered and inspected at **1440, 768 and 390 pixels**: valid ACTIVE, draft-only, valid ACTIVE with invalid DRAFT, missing PDF design, stale inventory, and several canonical choices sharing a Product. In all 18 cases document width equaled viewport width. Long Unicode Product names wrapped; summary metrics, check rows, badges, remediation controls and tabs remained visible. Mobile rows stack and remediation links have 44px minimum height. Keyboard Enter opened Generation Settings; click/tap opened PDF Appearance; browser Back and tab navigation worked. The established exact-choice disclosure opened accessibly and dismissed with Escape.

Screenshots are stored in [acceptance/milestone5_5](acceptance/milestone5_5/). Representative evidence:

| State | Desktop | Tablet | Mobile |
|---|---|---|---|
| Valid ACTIVE | [Desktop](acceptance/milestone5_5/valid-desktop.png) | [Tablet](acceptance/milestone5_5/valid-tablet.png) | [Mobile](acceptance/milestone5_5/valid-mobile.png) |
| Invalid DRAFT, valid ACTIVE | [Desktop](acceptance/milestone5_5/invalid-draft-desktop.png) | [Tablet](acceptance/milestone5_5/invalid-draft-tablet.png) | [Mobile](acceptance/milestone5_5/invalid-draft-mobile.png) |
| Missing PDF | [Desktop](acceptance/milestone5_5/pdf-desktop.png) | [Tablet](acceptance/milestone5_5/pdf-tablet.png) | [Mobile](acceptance/milestone5_5/pdf-mobile.png) |
| Stale inventory | [Desktop](acceptance/milestone5_5/stale-desktop.png) | [Tablet](acceptance/milestone5_5/stale-tablet.png) | [Mobile](acceptance/milestone5_5/stale-mobile.png) |

## NOT VERIFIED / known limitations

Authenticated real-store end-to-end acceptance and Figma comparison are NOT VERIFIED. Figma was not accessed. Browser fixtures do not verify actual publication or real PDF assignment mutations. No live Etsy/AI/storage/delivery or rendering availability is asserted. More than 100 associations is explicitly bounded; readiness cannot certify unseen choices. Cached catalog data is not a real-time source probe. Structurally malformed persisted payloads are read-only in the editor and need controlled repair rather than automatic replacement. No migrations or development/production database mutations were performed.

## Changed files

- Engine and shared validation: `src/modules/products/readiness.ts`, `readiness-service.ts`, `setup-validation.ts`, `validation.ts`, `service.ts`.
- Workspace presentation: `src/components/products/readiness.tsx`, `readiness.module.css`, `configuration.tsx`, `configuration-workspace.tsx`, `configuration-workspace.module.css`, `setup-model.ts`.
- Tests: `tests/product-readiness.test.ts`, `product-readiness.db.test.ts`, `fixtures/product-readiness.ts`, `product-workspace-loader.test.ts`, `product-workspace.test.ts`.
- Documentation: this report, README link and 18 fixture screenshots under `docs/acceptance/milestone5_5/`.

No schema, migration, intake, queue, generation engine, PDF renderer or snapshot files changed. Verified Next-generated next-env.d.ts/tsconfig.json noise was excluded.

## TESTED — final code validation

| Command | Result |
|---|---|
| `pnpm test` | 93 files, **968 tests passed** |
| `pnpm test:db` | 27 files, **529 tests passed**, isolated PGlite databases with repository migrations |
| `pnpm typecheck` | Passed on repository tsconfig after build completed |
| `NEXT_TELEMETRY_DISABLED=1 pnpm build` | Passed production webpack build |
| `git diff --check` | Passed |
| Lint | No repository lint script configured |

The new unit suite covers deterministic aggregation, separate ACTIVE/DRAFT results, invalid structures/workflows/inputs, PDF states, exact keys, duplicate labels, paused mappings, stale/unknown/partial evidence, safe remediation and read-only presentation. Five new database regressions use real repository schema/services/resolver and verify tenant/membership isolation, no mutations, publication invariants, PDF precedence, cached evidence validity, bounded query count and overflow. Existing Products, Orders, catalog, generation and document regression suites passed unchanged apart from updated Readiness presentation expectations.

An overlapping typecheck attempt encountered generated .next/types files while the build replaced them. After build completion and inspection/removal of only generated tooling noise, the standalone repository typecheck passed. No source workaround or unrelated change was needed.
