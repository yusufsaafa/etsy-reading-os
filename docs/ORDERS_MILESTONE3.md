# Milestone 3 — Orders List

Route: /orders. Dashboard, application shell, navigation, order detail and all production/PDF commands remain unchanged. The existing shared information popover provides status context; no inline informational disclosures are introduced.

## Architecture

The previous route fetched the entire workspace and called reading review per unit, then filtered/sorted in JavaScript. It had no pagination and an always-empty Completed filter. The list now uses a focused read-only ordersData projection, reuses the existing DashboardOrder result contract and OrderList component, and performs one database statement after verifyScope. No new API, domain model, migration, workflow or command is introduced.

The current-state classification follows the validated Dashboard SQL semantics. Persisted generation/queue/customer revision evidence is authoritative. Differential database tests compare Orders statuses with the existing Dashboard projection. Future lifecycle changes must keep both read projections aligned; Dashboard implementation was not edited in this milestone.

## Search, filters and sorting

URL state: q (trimmed, maximum 200 characters), filter, sort, page. Repeated/invalid values safely fall back; sort is newest by default, page is positive and bounded to seven digits. Search is case-insensitive literal substring matching over external order identifier, internal order UUID and retained line-item title. Percent, underscore and backslash are escaped; values are parameterized. No customer-name or full-text search is offered.

| Filter | Persisted classification |
| --- | --- |
| All | All store orders, including canceled |
| Pending | No higher-priority issue, active production or fully current successful reading results |
| In Production | QUEUED, CLAIMED, EXECUTING or RETRY_WAIT queue state, or PROCESSING generation, without higher-priority issues |
| Generated | Every reading has a successful latest generation at its current customer revision and no stored issues; no higher-priority state |
| Needs Attention | Distinct noncanceled orders with failed/attention production, stale generated results, stored issues, unpaid state or refund review |
| Canceled | Persisted canceled orders, taking precedence over other categories |

Attention precedence remains failure/queue attention, stale results, then information/setup issues. Retrying failure recovery is not terminal attention. Generated does not mean approved, PDF-complete or delivered; no generation does not mean Generated. The selected labels describe current reading production, while order detail remains authoritative for review actions.

Sort newest: purchase timestamp descending, UUID descending. Oldest: purchase timestamp ascending, UUID ascending. Dates use the existing displayDate UTC formatter. Legacy unsupported filters (new/info/ready/completed) fall back to All; they are not silently equated with the new lifecycle categories. Existing /needs-attention redirect still selects attention.

## Pagination and performance

Twenty orders per page. Database aggregates report exact matching count and lifetime store count; requested pages beyond the last page clamp to the last page. Search/filter submissions reset to page one, and pagination preserves search/filter/sort. Count and selected rows share one SQL snapshot. Product context is aggregated only for selected orders; no per-row network or review calls occur. Zero matched results remains page one of one.

Every order, line, reading, generation, queue and integration source is constrained to organization/store. Existing order_store_created tenant/purchase index and tenant identity constraints remain intact. Status aggregation scans authorized store history; literal title substring search and deep offset pages can become expensive at large scale. No query latency/large-store EXPLAIN benchmark was performed. Optimization or additional indexes require a separate demonstrated need; none were added here. Offset pages can shift between requests as the store changes.

## Presentation and access

One compact Orders heading, GET search/sort toolbar, six status filters, semantic order table and result/pagination footer. Persisted identifiers, retained line titles/quantities, reading count, truthful status and purchase date are shown; buyer personal information is not returned to the list. Pending and canceled are neutral, production has restrained blue treatment, generated uses calm success, actionable issues use warning styling.

Tablet reduces cell padding. At 760px and below, table rows reflow into compact records retaining order/status first, product context, purchase date and detail link. Filter controls wrap, search takes available width, and touch targets are at least 44px. Native headings/table headers/caption, named search/sort controls, aria-current filters, pagination landmark and existing focus treatment/reduced motion remain available.

currentScope runs before the query and preserves sign-in, missing-store and incomplete-onboarding boundaries. ordersData revalidates persisted membership through verifyScope; client parameters never select a store or organization. AccessDenied propagates. Other data errors show a safe unavailable state with state-preserving reload, without fabricated counts.

Empty states distinguish no persisted orders, search no matches and status no matches. A single Settings link appears when saved connection authorization/current-epoch import state needs review. Empty orders never claim zero Etsy sales or live synchronization. No fake records or unsupported list actions exist.

## Verification

VERIFIED PASS: 130 focused/regression tests across Orders, Dashboard, entry, shell, onboarding, seller status, popovers, PDF navigation and reading review; 36 database tests (7 Orders, 18 Dashboard, 11 onboarding); typecheck; production build; working and staged diff checks.

Commands: pnpm test with the focused/regression file list; pnpm test:db tests/orders-list.db.test.ts tests/dashboard.db.test.ts tests/onboarding.db.test.ts; pnpm typecheck; pnpm build; git diff --check and git diff --cached --check.

BROWSER ACCEPTANCE: NOT VERIFIED. Attached browser surfaces have no authenticated Reading OS tab; available Safari shows an unrelated site. Actual desktop/390px appearance, overflow, mobile table accessibility and interactions remain unverified. Structural tests do not establish visual acceptance.

Deferred: Order Detail redesign, generation/retry/PDF controls, messaging, delivery/refund/cancellation, ingestion, synchronization, notifications, analytics and infinite scroll. Pre-existing generated next-env.d.ts/tsconfig.json modifications remain preserved and excluded.

## Milestone 3.1 — Development sample preview

Run the existing local app with pnpm dev, complete normal sign-in/onboarding and open /orders. Select **Preview Sample Orders** in the header (equivalent to /orders?preview=sample). **SAMPLE DATA** identifies the read-only presentation. **Exit Preview** returns to /orders and its normal database query.

The route checks NODE_ENV === "development", then existing currentScope and a fresh verifyScope before dynamically importing fixtures. Only the exact single preview=sample token activates it. In production/test, the token is ignored, controls are absent and the fixture accessor rejects access. No public preview endpoint or client-selected tenant is added.

Fifty bounded deterministic records use DEMO-1001 through DEMO-1050, fixed varied sample purchase dates, five lifecycle states, single/multiple products, long and missing context, and reading counts one through seven. They are fictional presentation data, never PostgreSQL rows. The fixture module has no runtime database, Etsy, AI or queue dependencies. Only existing read-only access verification touches the database in preview.

The real OrderList, badges, date formatter, responsive CSS and pagination render the fixture records. The same validated search/filter/sort/page conventions apply; only this bounded sample list is filtered in memory. Search/filter submissions reset pagination and preserve the preview token. Sample identifiers are plain text, Open actions are disabled with an explanation, and no fake detail workflow exists.

Preview affects /orders only. Dashboard, products, queues, generation history, PDF Studio and integration state remain unchanged. Dates and labels are deliberately fictional, not live store evidence. The preview omits connection guidance rather than inventing connection state.

Verification: 141 focused/regression tests, typecheck, production build and diff checks pass. Tests cover nondevelopment rejection, exact-token validation, sign-in/onboarding/authorized scope, fixture sorting/filtering/pagination, no write calls, safe detail actions and Exit Preview. Browser acceptance remains NOT VERIFIED because no authenticated controllable Reading OS tab is available; actual desktop/390px rendering, touch behavior and overflow are not established by source tests. Database projection/schema/commands are unchanged; no real-store fixtures were inserted.

## Milestone 4 — Order Detail and safe sample details

This supersedes Milestone 3.1’s disabled sample-detail limitation.

The Orders table now includes the persisted buyer_name projection, with Customer unavailable when empty. No username field is stored, no name is inferred from email/personalization, and customer-name search is not introduced. Customer email/address are not selected for list presentation. Long names wrap with full accessible text.

Real /orders/[id] uses orderDetailData: verifyScope first, then the tenant-owned order, its lines/units, latest input revision and latest generation metadata per unit, associated queues, mappings and pinned product versions. Child projections use both organization/store ownership and owned IDs. No whole-store workspace is loaded. The shared OrderDetailView uses a 2:1 desktop grid: purchased evidence and readings on the left; payment, queue evidence and partial recorded activity on the right. Below 900px it stacks in DOM order. Original purchase answers and current customer answers are explicitly separated. Missing titles/inputs/queue evidence use concise truthful fallbacks.

Existing authorized InputEditor, product setup, ReadingPreparation and reading review/approval navigation remain available only for real orders. The existing functional customer-information editor disclosure is preserved as an essential workflow form, not informational help. Reference information uses InformationPopover. No new commands, provider calls, PDF/delivery workflows or schema changes were added. ReadingPreparation now requests only the latest generation through an optional bounded generationHistory read argument; its default callers remain compatible. Existing per-reading review eligibility/accounting validation remains authoritative and can still add queries for unusually large purchases.

Lifecycle precedence remains canceled, unpaid/refund, terminal production attention, stale result, persisted information/setup issues, active production, current generated results, pending. Active retry wait is not a terminal failure. Generated does not mean approved, PDF completed or delivered. Review availability still uses readingReviewStatus; unavailable/stale results do not gain review links. Recorded Activity is explicitly purchase plus latest generation record evidence, not a comprehensive audit trail or fabricated completion chronology. Result content remains accessible through the existing authorized review route.

Development sample Orders now include deterministic fictional customer names. Open/identifier links lead only to /orders/preview/DEMO-1001 through DEMO-1050. This static preview namespace cannot collide with real UUID orders. The server returns not found outside NODE_ENV=development; development requests must pass currentScope (authentication/onboarding) and verifyScope before dynamic fixture access. Invalid sample identities return not found. Sample details use the same OrderDetailView with no InputEditor, ReadingPreparation or review/action slots, and no database writes, provider calls or queue dispatch. Generated fixtures carry matching fictional generation evidence; active, attention, canceled, missing context, multiple products/readings and longer question scenarios remain deterministic.

Back links rebuild only validated q/filter/sort/page state, with preview=sample enforced for sample returns. No arbitrary return URL is accepted. Sample detail has Back to Sample Orders and Exit Preview to real /orders. Preview remains isolated from Dashboard, Products, PDF Studio and Settings.

Accessibility: semantic headings, labeled operational aside, readable long text, explicit textual statuses, existing focus/popover behavior, touch-friendly navigation, mobile table rows with customer identity, no informational inline accordions, no color-only state. No animation is introduced.

Verification: 177 focused/regression tests and 39 PGlite database tests pass; typecheck, production build and diff checks pass. Database tests use isolated fixtures, never the connected store. Browser acceptance: NOT VERIFIED. Controllable browser surfaces have no authenticated Reading OS tab; Safari shows an unrelated site. Actual desktop/390px visuals and overflow still require authenticated browser review. Deferred: full audit history, direct generation-result editing outside existing review, new workflow actions, customer-name search, missing username intake, and all non-Orders milestones.

**Finalization — 2026-10-10:** the historical regression blocker is resolved under explicit Milestone 4 finalization authorization. The three FAILED/PENDING/ANALYZING analysis cases expected PLATFORM_RULES alone, although their newly admitted contexts use generation-context/v2. The unchanged assembler intentionally appends INTEGRATION_RULES for that version; generation-integration tests independently require customerFields semantics and preserve the legacy branch. Only the affected parameterized assertions in tests/generation.db.test.ts changed: exact v2 system rules, unchanged pre/post-analysis system and parsed data, exact customerFields metadata and customer answers, and legacy contexts without integrationVersion retaining PLATFORM_RULES and excluding product/customerFields. JSON data is compared structurally because persisted JSONB can reorder object keys; no production prompt behavior changed.

Final verification on Node 22.23.1: the three previously failing cases pass; all 76 Generation database tests pass; all 39 Orders/Dashboard/onboarding database tests pass (115 across four files); 182 focused/regression tests pass across 21 files covering Orders/detail/sample, Dashboard, entry/shell/onboarding, status/popovers, PDF navigation, review and generation contracts. pnpm typecheck, pnpm build, and working/staged diff checks pass. Commands use pnpm test with those focused files; pnpm test:db tests/generation.db.test.ts -t 'only .* analysis uses byte-identical legacy manual context/prompt'; pnpm test:db tests/generation.db.test.ts tests/orders-list.db.test.ts tests/dashboard.db.test.ts tests/onboarding.db.test.ts; pnpm typecheck; pnpm build. The initial targeted run exposed a test-only byte comparison of JSON with reordered keys; the corrected structural data comparison passes without weakening the exact system-rule assertion. BROWSER ACCEPTANCE: NOT VERIFIED; no new browser acceptance was performed during finalization. Generated next-env.d.ts and tsconfig.json remain modified and excluded from the Milestone commit. No Milestone 4.1 feature, new schema, provider dispatch, push or deployment was introduced by finalization.

Milestone files: src/app/(operations)/orders/[id]/page.tsx; src/app/(operations)/orders/preview/[id]/page.tsx; src/components/order-detail.tsx; src/components/order-detail.module.css; src/components/order-list.tsx; src/components/orders-list-page.tsx; src/components/orders.module.css; src/components/generation/reading-preparation.tsx; src/modules/orders/customer.ts; src/modules/orders/detail.ts; src/modules/orders/service.ts; src/modules/orders/sample-preview.ts; src/modules/generation/service.ts (bounded read only); tests/order-detail.test.ts; tests/orders-list.test.ts; tests/orders-list.db.test.ts; tests/orders-sample-preview.test.ts; tests/review-orders.test.ts; this document. Generated next-env.d.ts and tsconfig.json changes remain separate and untouched.
