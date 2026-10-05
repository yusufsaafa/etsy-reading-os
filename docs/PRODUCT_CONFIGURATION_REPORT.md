# Product Configuration implementation report

Branch: `codex/ui-ux-design-lock`. Parent: `9d33da6917ca0e782c59fa120ebda564ccae39c5`.

## Implemented domain

Generic Product identity and immutable ProductVersion configuration, with ordered InputDefinitions and ContentSections plus output/workflow preferences. Two tables with tenant-scoped composite references, active/draft uniqueness, immutable published versions/unit bindings and deferred active-pointer consistency. Existing listing mappings, exact variants, CustomerInput revisions, quantity expansion and triage are reused. No second mapping/status engine; no new dependencies.

Draft saves are revision-checked and replay-safe. Activation validates server-side and atomically archives/activates/updates the pointer. Edits create a separate draft. New incoming readings bind their effective version; history keeps its original version after activation and replay. One selected active unpaused product enables persisted onboarding completion; other selections remain Setup required.

## Validation

| Command | Exact result |
| --- | --- |
| `pnpm typecheck` | Exit 0, no errors |
| `pnpm test` | Exit 0, 7 files / 34 tests passed |
| `pnpm test:db` | Exit 0, 3 files / 40 tests passed |
| `pnpm build` | Exit 0, optimized compilation, TypeScript and route generation passed |
| `pnpm exec drizzle-kit generate` | Exit 0, 17 tables; no schema changes |

74 tests passed in total; 22 added (17 database, 5 deterministic validation/correction). Existing 52 tests were retained. Coverage includes tenant/forged scope, OAuth state, encrypted secrets, disconnect fencing, duplicate intake, quantity, rollback, draft persistence, invalid/atomic activation, active-version uniqueness, immutable history, v1/v2 binding, generic required/optional inputs, Unicode/ISO dates, ambiguous aliases, exact variant/SKU behavior, replay, legacy compatibility and partial onboarding completion. No tests were removed or weakened.

Node 22.23.1 and pnpm 9.7.1. Package manifest and lockfile unchanged. Next-generated compiler/config edits were excluded; original strict settings were retained and checked again.

## Native PostgreSQL and browser evidence

Migration 0003 applied and replayed against an isolated local native PostgreSQL acceptance database. Fixture seed replay succeeded with six orders, seven lines and ten units in its own synthetic demo store. Existing data was preserved. A separate synthetic acceptance account used real Auth.js development sign-in, store creation, demo Etsy connection, worker import, product selection, incomplete draft save/reload, invalid activation, valid v1 activation and Continue to Home.

Products → Edit created v2; saving/reloading kept v1 active with its unchanged PDF preference while v2 had a Text preference. After v2 activation, native queries confirmed v1 archived and an earlier Ready reading still bound to v1; a new reading bound to v2 and waited for its added Occasion field. Mobile customer correction provided that field and deterministically changed the reading to Ready. Create reading remained disabled. Mixed Order #2002 still had three independent readings.

Choose Products, Product Setup and Products were rendered and inspected at 1440px, 768px and 390px. Document width equaled viewport width on all three screens at all sizes. Setup controls measured 44px; checkbox label targets were 44px. Phone order detail/correction was also inspected at 390px with no overflow. Navigation and the locked neutral/blue visual system were reused; no Landing/Auth/Home redesign. Browser viewport overrides were reset. Synthetic screenshots are in `docs/screenshots/`; final visual approval belongs to the product owner.

## Limitations / non-goals

- Live Etsy intake remains gated by the existing response-contract limitation. Tests and browser use synthetic, clearly marked development shop data; actual Etsy OAuth/import was not exercised.
- Variant setup supports exact variants observed on imported purchased lines; full live inventory/variation discovery is not implemented. Images remain truthful placeholders.
- Legacy mapping checks remain usable but are not configured products. Newly unconfigured historical readings are not silently assigned today’s version; explicit audited historical assignment is future work.
- Activation rejects Automatic. Text/PDF and Manual/Assisted persist preferences only; no generation, PDF rendering, sending, billing or seller identity.
- Existing production authentication limitations are unchanged: self-service email accounts are development-only, configured GitHub OAuth is the genuine production path.

## Local verification

Use Node 22.12+, `pnpm install --frozen-lockfile`, existing local configuration, `pnpm db:migrate`, `pnpm db:seed`, `pnpm dev`, and `pnpm worker` in another terminal. See LOCAL_DEVELOPMENT.md for credentials/configuration handling and the exact new-account acceptance journey. Never test against a production database.

## Files changed

- `AGENTS.md`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/LOCAL_DEVELOPMENT.md`
- `docs/ONBOARDING_REPORT.md`
- `docs/PRODUCT_CONFIGURATION.md`
- `docs/PRODUCT_CONFIGURATION_REPORT.md`
- `docs/PRODUCT_SPEC.md`
- `docs/UI_UX_DESIGN_LOCK.md`
- `docs/screenshots/configuration-picker-1440.png`
- `docs/screenshots/configuration-picker-390.png`
- `docs/screenshots/configuration-picker-768.png`
- `docs/screenshots/configured-products-desktop.png`
- `docs/screenshots/configured-products-mobile.png`
- `docs/screenshots/configured-products-tablet.png`
- `docs/screenshots/configured-reading-mobile.png`
- `docs/screenshots/product-setup-desktop.png`
- `docs/screenshots/product-setup-mobile.png`
- `docs/screenshots/product-setup-tablet.png`
- `drizzle/0003_dapper_sir_ram.sql`
- `drizzle/meta/0003_snapshot.json`
- `drizzle/meta/_journal.json`
- `src/app/(operations)/orders/[id]/page.tsx`
- `src/app/(operations)/products/[id]/setup/page.tsx`
- `src/app/(operations)/products/page.tsx`
- `src/app/globals.css`
- `src/app/onboarding/products/setup/page.tsx`
- `src/components/customer-input-fields.ts`
- `src/components/input-editor.tsx`
- `src/components/products/actions.ts`
- `src/components/products/editor.tsx`
- `src/components/products/setup.module.css`
- `src/components/products/setup.tsx`
- `src/db/schema.ts`
- `src/modules/intake/contracts.ts`
- `src/modules/intake/service.ts`
- `src/modules/onboarding/service.ts`
- `src/modules/products/contracts.ts`
- `src/modules/products/runtime.ts`
- `src/modules/products/service.ts`
- `tests/product-validation.test.ts`
- `tests/products.db.test.ts`

## Recommended next milestone

SELLER / READER IDENTITY + STYLE LIBRARY. Do not add style analysis or generation automatically. Keep identity revisions separate from immutable product configuration.
