# Milestone 2.1D — Final Dashboard Design Lock

Route: `/`, with server-rendered `?range=7`, `?range=30`, or `?range=90`. Default and invalid/repeated values resolve to 30 days. The approved shell, navigation, authentication and onboarding boundaries remain unchanged.

**Dashboard statistics reflect orders persisted in Reading OS. They do not necessarily represent all Etsy shop activity.** Normal live synchronization remains gated; this milestone does not enable it.

## Composition and adaptive states

Exactly four compact KPI cards use existing shell tokens: Orders, Generated Orders, Issues, Avg AI Execution. Each shows its time context. Definitions are available in a native keyboard/touch-accessible disclosure rather than permanent paragraphs.

- One unified composition: four KPIs followed by Orders Over Time, Requires Attention, Recent Orders and Top Products, regardless of lifetime order count.
- Desktop positions stay fixed: Order Activity/recent orders on the left, attention/product ranking on the right. DOM order is chart, attention, recent orders, products; mobile stacks in that same order.
- Zero lifetime orders: concise empty states inside the normal sections, no fake chart or ranking, and one persisted-state integration guidance message. There is no separate Getting Started page composition.
- Existing orders: real chart/ranking values, stronger KPI numbers, emphasized order links and concise truthful status badges. A period with no activity retains lifetime recent orders and the same layout.
- Attention: the existing bounded list keeps its priority ordering and destinations inside the fixed right panel, emphasized with a warning border and count. No issues shows a compact All clear row. No CSS order manipulation or new resolution workflow.
- Production: a compact reading-queue strip appears only when a current count is nonzero. No controls or Production destination are added.

Recent orders use the existing read contract, purchase ordering and order-detail links. A Dashboard-specific compact list replaces the shared five-column table here because its viewport breakpoints do not reflect the narrower grid column. Orders page presentation and fetching are unchanged.

## KPI definitions

| KPI | Meaning | Time basis |
| --- | --- | --- |
| Orders | Count of persisted purchases in the selected UTC interval, including canceled orders | Selected period |
| Generated Orders | Existing Milestone 2 current generated-order classification | Now, independent of range |
| Issues | Existing distinct noncanceled attention-order count | Now, independent of range |
| Avg AI Execution | Mean recorded execution duration of eligible successful reading requests | Request finished in selected period |

The existing lifecycle classification is unchanged: canceled, attention, active production, fully generated, then pending. Generated requires every reading to have a successful latest generation with matching customer revision and no issues; absent generation rows do not count as generated. Generated does not mean approved, PDF-complete or delivered.

Attention preserves its maximum of six distinct orders, existing safe descriptions and detail links. Failures/queue attention precede stale results, then stored information/payment/refund issues, with oldest purchase and UUID tie-breakers. Retry-wait/queued/active recovery is not silently converted into terminal failure. Attention does not inherit the analytics date filter.

## Period and analytics calculations

One render-time cutoff is passed into the read projection. Periods begin at UTC midnight N−1 days before today and end at that exclusive cutoff. Today is partial; future purchases and records exactly at the cutoff are excluded. The server or browser's local timezone does not affect buckets.

- Order Activity (existing Orders Over Time dataset): database-side UTC daily counts from `orders.createdAt`, which intake retains from the external purchase timestamp. Returns exactly 7/30/90 buckets, including explicit zero days. A wholly empty period renders concise no-activity copy instead of a zero-filled chart.
- Top Products: group period line items by Etsy `listingExternalId`; count distinct `orderId`, ignoring quantity and duplicate lines/variants within an order. Include canceled purchases consistently. Return at most five, sorted count descending then external ID ascending. Current owned listing title is preferred; otherwise use the most recent deterministic retained line title, then `Listing #…`. A generic retained `Unconfigured purchase` title is not presented as an original Etsy listing title. Listings do not require active Product configuration and no ambiguous Product detail links are created.
- Avg AI Execution: `ai_requests.durationMs` for operation `PERSONALIZED_CONTENT_GENERATION`, provider `google` (the current real provider), `SUCCEEDED` requests with a generation binding, nonnull start/finish/duration, nonnegative duration and finish not before start. Filter by finish timestamp using the shared period. Fake providers, style analysis, failed/pre-dispatch/running requests and missing/invalid timing are excluded. Each eligible successful attempt contributes once. Failed-attempt duration and retry backoff are not included. No samples displays `—`; sample count appears in definitions.

Duration is the gateway's recorded provider execution plus response validation. It is not delivery time, pure model inference time, or `generation.completedAt - generation.createdAt`, which can include retries.

## Integration state

The projection returns source, persisted connection status, expiry at the shared cutoff and latest sync status for the **current connection epoch**. Old failed imports do not remain current after reconnection. No tokens, scopes or raw provider error bodies are returned.

The compact connection badge and native Connection details disclosure retain the single zero-order integration presentation. It distinguishes absent connection records, disconnected, connected/no imported orders, reauthorization required, expired authorization, queued/running/failed imports and successful imports with zero stored orders. Unknown/absent state does not become connected or disconnected. Demo connections are labeled as such. Existing Settings links provide navigation; no new sync action or promise of live updates is introduced.

## Query and authorization architecture

`currentDestination` and `currentScope` remain authoritative. `dashboardData` revalidates persisted membership with `verifyScope`; every new source is constrained by organization and store. Existing earliest-authorized-store selection is preserved. URL parameters select a range only, never a tenant.

The existing current-state SQL projection is extended, not replaced. Its lifetime order classifications, latest generation selection, bounded recent/attention lists and queue counts remain intact. A period-order CTE uses direct indexed tenant/date predicates; period lines are shared by the ranking. Daily buckets and AI timing are aggregated in the database. Only five ranked title fallbacks are resolved against shared period evidence. No full order history is loaded into JavaScript, no per-order requests occur, and aggregates/lists share one SQL statement snapshot.

No schema/index changes, API layer, polling, generation, accounting, production or PDF behavior changes are introduced. Current-state aggregates still require store history. Completed-request timing lacks a dedicated tenant/finish-time index; large-store query plans and latency remain unmeasured and may require separately authorized optimization.

## Accessibility and responsive behavior

Real range links have an accessible navigation label and active-state indication. Native details/summary provides keyboard, mouse and touch access to definitions and daily values. The SVG is visual; an accessible date/count table provides every daily value, including zero days, without hover. Keyboard-focusable scroll region bounds long daily tables. Product bars are accompanied by titles and integer order counts.

Desktop uses a 2:1 grid where space permits. Tablet reflows to one column; mobile uses two-by-two KPIs, stacked panels and compact order rows. Touch controls target 44px. Four KPI cards share a minimum height with dominant tabular numbers. The fixed content grid aligns two rows; panel headings, subtle borders/shadows and restrained empty-state symbols clarify hierarchy without fake chart content. Recent-order status badges remain truthful; ranking bars retain integer counts. Existing focus treatment, mobile drawer, main landmark and reduced-motion behavior are preserved.

Loading retains compact skeletons with `aria-busy`. Query failure renders unavailable copy and a working range-preserving reload link rather than invented zeros. AccessDenied is propagated. Authentication/onboarding runs before Dashboard data or loading state is streamed.

## Verification and limits

VERIFIED PASS: 94 focused UI/range/root-entry and shell/navigation/onboarding/PDF/access tests; 45 persisted Dashboard/production/onboarding database tests (18 Dashboard, 27 regressions); typecheck; production build; working and staged diff checks. Database fixtures enforce the existing accounting contract and make no provider dispatches.

Commands: `pnpm test` with the focused/regression file list; `pnpm test:db tests/dashboard.db.test.ts tests/production.db.test.ts tests/onboarding.db.test.ts`; `pnpm typecheck`; `pnpm build`; `git diff --check` and `git diff --cached --check`.

Design implementation: **COMPLETE AND LOCKED** after the tests, typecheck and production build pass. This is separate from browser visual acceptance.

Browser acceptance: **NOT VERIFIED**. No authenticated controllable Reading OS tab was available; attached browser surfaces had no tabs and the available Safari session showed an unrelated site. No repository-supported isolated Dashboard browser preview or Storybook was found. Desktop/390px empty and populated rendering, chart readability, actual overflow, touch interaction and drawer compatibility remain unverified. Populated markup is covered by isolated test fixtures with five recent orders, three ranked listings, real daily counts and an attention item; no fixtures were written into the real store database or exposed at runtime. Source/UI tests do not establish visual PASS.

Deferred: revenue, traffic, profitability, success-rate percentages, AI cost analytics, PDF/document queue aggregation, review-specific metrics, production controls, live synchronization, polling and the broader Orders redesign.

Pre-existing generated `next-env.d.ts` and `tsconfig.json` changes remain preserved and excluded from this milestone commit.
