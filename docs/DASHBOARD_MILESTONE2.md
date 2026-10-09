# Milestone 2 — Operational Dashboard

Route: `/`. The approved shell and navigation are unchanged. The Figma reference's compact joined metrics, attention list and recent-order surface are adapted with existing semantic tokens and the reusable `OrderList`.

## Sections and sources

- Header: Dashboard, with an operational description.
- Store notices: persisted `etsy_connections` status/expiry and latest `sync_runs` outcome; existing Settings destination.
- Overview: four order aggregates, defined below.
- Requires Attention: at most six distinct orders, with existing order-detail links.
- Recent Orders: five persisted purchases, using the existing Orders table component.
- Production Overview: current **reading production** queue entries, one per fulfillment unit.
- Contextual navigation: Products and PDF Studio, with no new actions.

`src/modules/dashboard/service.ts` is a read-only projection of existing tables, not a new lifecycle or backend subsystem. It uses `orders`, `order_line_items`, `fulfillment_units`, `generations`, `production_queue`, `etsy_connections` and `sync_runs`. No customer answers, provider error text, emails or snapshots are returned.

## Order metric definitions

Orders do not have a persisted unified lifecycle status. The projection classifies each order once, in this precedence:

1. Canceled: `orders.canceled`; excluded from operational categories and attention.
2. Attention: unpaid orders, refunds other than `none`, persisted reading issues, terminal/current generation failures, queue `ATTENTION`, or a successful latest generation whose customer revision differs from the reading revision.
3. In production: at least one queue entry in `QUEUED`, `CLAIMED`, `EXECUTING`, `RETRY_WAIT`, or latest generation in `PROCESSING`, and no attention condition.
4. Generated: at least one reading, **every** reading has a latest `SUCCEEDED` generation with matching customer revision and no issues, and no earlier category applies. Missing generation rows explicitly count as not generated.
5. Pending: remaining noncanceled orders, including partially generated work without active production or issues.

Visible cards: Total Orders (all persisted orders, including canceled), Pending Orders, In Production, Generated Orders. Attention has its own total. These exclusive categories plus canceled partition Total Orders. Generated does **not** imply review approval, PDF completion or delivery. Completed Orders is omitted because delivery is not represented reliably by these states. Ready for Review is not inferred from generation success because existing approval state is a separate contract.

## Attention and production semantics

Attention is ordered by processing failure/queue attention first, stale generated information second, other stored issues/payment/refund holds third; oldest purchase first within priority, then UUID ascending. Unknown persisted issue codes remain actionable through generic safe copy; no unsupported issue code is invented. A latest failed generation with a queued/claimed/executing/retry-wait queue entry is treated as active recovery rather than a new terminal failure. Successful generated work alone is not an error.

Production counts queue entries independently of order categories:

| Label | Persisted queue states |
| --- | --- |
| Queued | `QUEUED` |
| Active | `CLAIMED`, `EXECUTING` |
| Waiting to retry | `RETRY_WAIT` |
| Needs attention | `ATTENTION` |

Canceled orders are excluded. `SKIPPED` and `COMPLETED` are not current activity. Retries update a single unique queue row; they do not inflate these counts. Orders with issues and active queue rows may appear in attention while their queue rows remain visible in production. Direct/manual generation can affect In Production without creating a queue entry; these different counting units are labeled explicitly.

## Access and query behavior

The existing root entry, authenticated `currentScope`, onboarding redirects and shell remain authoritative. The query revalidates persisted membership via `verifyScope`. Organization and store predicates constrain every source; joined children retain matching tenant keys. The existing selected store semantics (earliest authorized store through `findUserStore`) are preserved, without cross-store aggregation or invented switching.

A single SQL statement provides a consistent aggregate/list snapshot. The latest-generation CTE uses `(unit_id, created_at DESC, id DESC)` once per store instead of repeatedly scanning attempts per reading. Counts are computed in the database, never by loading all records into JavaScript. Recent and attention lists are limited to five and six; listing titles are loaded only for their combined order IDs. Recent sorting is purchase `orders.created_at DESC, id DESC`; intake sets this from the external purchase timestamp, not import time. Dates display in UTC.

The query must scan relevant store history to calculate exact totals; no schema/index changes were made. Very large stores may need measured query-plan optimization in a separately authorized milestone. No polling, writes, billable requests or new API routes are introduced.

## States and accessibility

Authentication/onboarding runs before the Dashboard Suspense fallback. Loading uses stable compact skeleton surfaces and `aria-busy`. Empty orders link to integration Settings; empty reading-attention and queue states describe their scope. Data errors show unavailable data with reload/Orders links, never fabricated zeros or provider internals. AccessDenied is propagated to the existing access/error boundary.

Dashboard-specific CSS uses existing shell tokens, two-column metrics and production counts at 760px, stacked attention rows, wrapping text, and 44px action targets. The existing responsive Orders table is reused. Semantic section headings, definition lists and real links preserve keyboard focus treatment; no new main landmark or navigation system is added. Reduced motion is respected.

## Deferred and limited

- Delivery/completed-order analytics, revenue, trends and charts.
- Review approval aggregation and review-specific queues.
- PDF/document-production queue aggregation: the Production Overview is explicitly the reading queue, not all document jobs.
- Production controls, retries, new workflows, Readers/Production pages and navigation.
- Live refresh/polling and broader Orders redesign.

## Verification

- VERIFIED PASS: repository branch/base checks; focused Dashboard and shell/navigation/onboarding/PDF/access tests; persisted PGlite Dashboard aggregates, isolation, attention priority, queue transitions, retry counting, empty/failure states and bounded stable ordering; existing production/onboarding database regressions; typecheck; production build; diff check.
- Browser acceptance: NOT VERIFIED. Controllable browsers have no attached authenticated tabs; native Chrome shows its profile picker, and inspected Safari is not displaying Reading OS. Desktop/mobile visual layout, overflow and interactive navigation have not been accepted in a live authenticated browser.
- Pre-existing generated `next-env.d.ts` and `tsconfig.json` changes are preserved and excluded from the milestone commit.
