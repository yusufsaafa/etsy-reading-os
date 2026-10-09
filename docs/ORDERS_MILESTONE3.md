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
