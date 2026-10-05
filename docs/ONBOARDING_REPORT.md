# Initial onboarding implementation

Scope: Store -> Etsy -> Products -> explicit Product Setup boundary. Existing operations, Auth.js, Etsy OAuth, encrypted credentials, tenant isolation, intake idempotency and Order -> LineItem -> FulfillmentUnit remain intact. No new dependencies, AI, documents, delivery or billing.

## Behavior

- New authenticated sellers without a store enter `/onboarding/store`; replay-safe store creation reuses the existing organization/store transaction.
- `/onboarding/etsy` explains read-only access before authorization, presents connection/errors/reauthorization, and provides secondary disconnect. Existing OAuth validation, secret vault and connection fencing are unchanged.
- Continue requests import through the background-job port, using a server-derived connection replay key. No import is triggered by a GET. Listings and selected IDs are scoped server-side; client props contain no credentials.
- `/onboarding/products` provides search, active-listing selection, select/deselect all, nonzero validation, pending/empty/error recovery and a selected-count action.
- `/onboarding/products/setup` confirms saved intent and stops. It does not create configurations or unlock operations. Existing stores are migrated as complete and retain Milestone 1 access.

## Data changes

Migration `0001_violet_shard` adds constrained store progress and `listing_selections`, with short explicit unique/ownership constraint names. Product selection is separate from mappings and is replaced transactionally under the store lock. Cross-tenant/inactive selections fail without overwriting the previous selection. Replay creates no extra selection rows or audit events. No intake table cardinality or service behavior changes.

## Final checks

Node 22.23.1 / pnpm 9.7.1. Existing locked dependencies installed, including Auth.js; no package manifest or lockfile changes.

| Command | Result |
| --- | --- |
| pnpm typecheck | Exit 0; no TypeScript errors |
| pnpm test | Exit 0; 4 files, 20 tests passed |
| pnpm test:db | Exit 0; 2 files, 19 tests passed |
| pnpm build | Exit 0; production compilation, TypeScript and route generation passed |

39 tests passed overall: 31 existing regressions plus 8 onboarding tests. The existing security regressions include tenant isolation/forged scope, OAuth state, encrypted secrets, duplicate intake, quantity expansion, rollback/retry and disconnect fencing. A generated PostgreSQL constraint-name collision was found and fixed before these final results. An incomplete optional macOS dependency install was repaired using the same frozen lockfile; no test or authentication substitute was used. Stale development-generated route types were cleared; strict compiler settings are unchanged.

## Browser and native database verification

Isolated native PostgreSQL database with both migrations; real Auth.js development sign-in, store creation, demo connection through the existing service, background worker import, individual/select-all/deselect/search, count-aware zero disabling, selection/reload/replay, setup boundary, Home gating, disconnect and stored reauthorization presentation were exercised. Authorization-failure message was inspected using its presentation notice; live Etsy authorization was not tested.

Create Store, Connect Etsy and Choose Products were rendered at 1440px, 768px and 390px. Measured document width equaled viewport width at every screen/width. Primary controls measured 44px high; selection rows measured 80px. Screenshots were inspected for typography, separators, neutral/blue palette, CTA hierarchy and absence of concatenation. Desktop and phone product screenshots are in `docs/screenshots/`. Final visual acceptance belongs to the product owner.

Native assertions confirmed two persisted selections and one selection audit after replay, zero mappings, Order #2002 with two purchased lines and three independent readings, and cleared credentials after disconnect. This supplements the PGlite regression suite; it is not a live Etsy contract test.

## Limitations

Live Etsy import remains blocked by the existing unverified response contract; connected live stores receive an honest import-unavailable error. No demo data substitutes for live data. The canonical listing contract does not yet carry images/variant summaries, so selection uses truthful thumbnail placeholders. Product Setup is intentionally unavailable. Native validation used an isolated synthetic shop; remote revocation and actual Etsy OAuth remain untested.

## Next task

Product-owner review of the onboarding screens, followed by verified live Etsy intake contract work before production onboarding. Product Setup requires separate authorization.

## Files changed

- `src/db/schema.ts`
- `src/modules/identity/service.ts`
- `src/modules/identity/session.ts`
- `src/modules/onboarding/service.ts`
- `src/app/actions.ts`
- `src/app/api/etsy/callback/route.ts`
- `src/app/globals.css`
- `src/app/onboarding/actions.ts`
- `src/app/onboarding/error.tsx`
- `src/app/onboarding/etsy/page.tsx`
- `src/app/onboarding/layout.tsx`
- `src/app/onboarding/loading.tsx`
- `src/app/onboarding/page.tsx`
- `src/app/onboarding/products/page.tsx`
- `src/app/onboarding/products/setup/page.tsx`
- `src/app/onboarding/store/page.tsx`
- `src/components/onboarding/forms.tsx`
- `src/components/onboarding/onboarding.module.css`
- `src/components/onboarding/shell.tsx`
- `tests/onboarding.test.ts`
- `tests/onboarding.db.test.ts`
- `drizzle/0001_violet_shard.sql`
- `drizzle/meta/0001_snapshot.json`
- `drizzle/meta/_journal.json`
- `docs/UI_UX_DESIGN_LOCK.md`
- `docs/ARCHITECTURE.md`
- `docs/LOCAL_DEVELOPMENT.md`
- `docs/ONBOARDING_REPORT.md`
- `docs/screenshots/onboarding-products-1440.jpg`
- `docs/screenshots/onboarding-products-390.jpg`

## Product configuration follow-up

The earlier placeholder limitation above is superseded by the real Product Setup implementation documented in [PRODUCT_CONFIGURATION.md](PRODUCT_CONFIGURATION.md). Selected listings create drafts through authorized POST commands. Save/reload preserves configuration; activation validates and publishes a version transactionally. Continue to Home persists completion only after at least one selected, unpaused active product; the other selections may remain Setup required. Previous onboarding test results above are historical; current validation is recorded in PRODUCT_CONFIGURATION_REPORT.md.

## Seller/style compatibility follow-up

Seller identity and style setup now lives in Settings after the existing product-based Continue to Home. Completion records are not reset or reinterpreted; one selected active product still permits completion, and no seller/style data is invented for legacy stores. The new production-context read reports missing identity/style independently. Before generation, explicitly revise new-store onboarding to include Profile → Style → Store ready and enforce context completeness at production admission while retaining completed stores’ operational access. See SELLER_STYLE.md and SELLER_STYLE_REPORT.md.
