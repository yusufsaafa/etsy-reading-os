# Public entry / authentication integration report

Date: 2026-10-05. Branch: `codex/ui-ux-design-lock`. Base: `0ec6f934283a9c63b46bed3258c8500b210e763f`.

## 1. Previous routing problem and root cause

Before changes, `/` belonged to `(operations)` and its layout required an authenticated, completed store. Logged-out visitors were redirected to `/sign-in`. A new authenticated user was redirected through `/onboarding` to Store; an incomplete store resumed its saved stage; a completed store saw Home. There was no public Landing route/component or persistent email registration page. Stage-only resume could send a disconnected seller to a later step and require another redirect. Logout returned sign-in instead of the public product experience.

README, AGENTS, PRODUCT_SPEC, ARCHITECTURE, DESIGN_PRINCIPLES, UI_UX_DESIGN_LOCK and ONBOARDING_REPORT were read before changing code. Existing root/layout, Auth.js callbacks, identity and store initialization, onboarding services/pages and tests were inspected. No domain rewrite was needed. The repository had visual guidance but no approved public Landing implementation/image asset; the prescribed content now uses the existing palette/primitives, without claiming external-reference pixel matching.

## 2. Files changed

- `.env.example` — modified
- `README.md` — modified
- `docs/ARCHITECTURE.md` — modified
- `docs/LOCAL_DEVELOPMENT.md` — modified
- `docs/UI_UX_DESIGN_LOCK.md` — modified
- `drizzle/meta/_journal.json` — modified
- `scripts/configure-local.mjs` — modified
- `src/app/(operations)/layout.tsx` — modified
- `src/app/(operations)/page.tsx` — deleted
- `src/app/(operations)/settings/page.tsx` — modified
- `src/app/onboarding/layout.tsx` — modified
- `src/app/onboarding/products/setup/page.tsx` — modified
- `src/app/sign-in/page.tsx` — deleted
- `src/auth.ts` — modified
- `src/components/onboarding/shell.tsx` — modified
- `src/db/schema.ts` — modified
- `src/modules/identity/session.ts` — modified
- `src/modules/onboarding/service.ts` — modified
- `tests/onboarding.db.test.ts` — modified
- `vitest.config.ts` — modified
- `src/app/page.tsx` — added
- `src/components/operations-home.tsx` — added
- `src/components/operations-shell.tsx` — added
- `src/modules/identity/accounts.ts` — added
- `src/modules/onboarding/destination.ts` — added
- `src/components/entry/auth-shell.tsx` — added
- `src/components/entry/auth-forms.tsx` — added
- `src/components/entry/entry.module.css` — added
- `src/components/entry/landing.tsx` — added
- `src/app/(public)/auth-actions.ts` — added
- `src/app/(public)/sign-up/page.tsx` — added
- `src/app/(public)/sign-in/page.tsx` — added
- `tests/entry.test.ts` — added
- `tests/session-guards.test.ts` — added
- `docs/screenshots/entry-sign-up-390.jpg` — added
- `docs/screenshots/entry-landing-1440.jpg` — added
- `docs/screenshots/entry-resume-setup-390.jpg` — added
- `drizzle/0002_dark_lockheed.sql` — added
- `drizzle/meta/0002_snapshot.json` — added
- `docs/ENTRY_AUTH_REPORT.md` — added

The old Home page and operations layout were extracted without changing their content/behavior into shared server components. Old route files are removed to avoid duplicate `/` or `/sign-in` definitions. `package.json`, `pnpm-lock.yaml`, global application CSS, Etsy OAuth/intake services and core intake tests remain unchanged. No dependency was introduced.

## 3. Public/auth routes

- `/`: public Landing when logged out; unchanged operational Home/shell when explicitly completed; server redirect otherwise.
- `/sign-up`: minimal account shell, genuine configured GitHub OAuth and an honest persistent development email-registration boundary.
- `/sign-in`: same shell, genuine configured GitHub OAuth, development email credentials and existing demo login under secondary disclosure.
- Existing onboarding and operational URLs remain unchanged.

Landing content follows the supplied hero/journey. Illustrative order UI is labeled preview; future creation/review/sending are clearly coming later. Public/auth/onboarding have no operations sidebar.

## 4. Backend/auth changes

Auth.js is still the only session/authentication system. Nullable unique email and nullable password hash extend `app_users` in migration `0002_dark_lockheed.sql`. Development registration validates/normalizes email, validates name/password, creates a random namespaced identity, stores a versioned salted scrypt hash and signs in through Auth.js Credentials. A duplicate email only reuses an account after password verification; it cannot overwrite credentials/name. Registration itself creates no organization/store. Existing user-row-locked transactional store creation handles workspace initialization/replay.

Both registration and password authorization require non-production runtime, `DEV_ACCOUNT_AUTH_ENABLED=true` and `ETSY_ADAPTER=fixtures`. The service and provider enforce this. Production always disables them even if the flag is true. Configured GitHub OAuth retains its namespaced persistent identity callback. No fake Google provider, plaintext password, custom cookie/session implementation or client-owned tenant scope exists.

## 5. Central destination logic

`resolveSellerDestination` derives the next destination from session identity, authorized membership/store, explicit completion, connection status/expiration and persisted selections:

| Persisted state | Destination |
| --- | --- |
| No identity | public `/` |
| No authorized store | `/onboarding/store` |
| Explicit completed store | Home `/` |
| Incomplete; no usable Etsy connection | `/onboarding/etsy` |
| Connected; no selected products | `/onboarding/products` |
| Connected; selected products, not configured | `/onboarding/products/setup` |

Selection never marks completion. An interrupted stage write does not hide an existing connection/selection. Disconnect returns an incomplete seller to Etsy while retaining selections. Completed legacy stores keep operational access and surface connection attention inside operations. Root/auth/resume/protected operational guards use this resolver; backward review remains possible. The Setup boundary checks the same resolver to avoid cycles.

## 6. Security preserved

All tenant/store resolution stays server-side through membership and authorization. Existing composite database ownership constraints, audit behavior, order/line/reading intake, replay protection, rollback, OAuth state/PKCE, encrypted Etsy tokens and disconnect fencing remain intact. No token/hash enters an auth public DTO. Authentication errors are generic and credentials are not logged. Next.js Server Action origin protections remain enabled. Logout only invokes Auth.js session termination with public `/` redirect; it never changes business/onboarding data.

## 7. Tests added/updated

13 tests added: seven public-entry/logout/redirect cases, two session-guard cases and four database account/resume cases. They cover public root, absent sessions before tenant queries, incomplete and completed root behavior, every onboarding destination, persistence/hash/private DTO, duplicate email/password protection, workspace replay/isolation, production gate and disconnect resume. Existing selection, forged scope, OAuth-state, secret-handling, intake duplicate/quantity/rollback and fencing tests still pass. The live-import test still asserts the contract gate and no started import; its resume expectation now correctly targets Products for an already-connected shop.

## 8. pnpm typecheck

`pnpm typecheck`: exit 0. Full strict TypeScript check passes. An initial stale generated route cache referred to moved pages; the production build regenerated it. No compiler option or security/test weakening was used. Validation used Node.js 22.23.1 and pnpm 9.7.1.

## 9. pnpm test

`pnpm test`: exit 0; **6 files, 29 tests passed**.

## 10. pnpm test:db

`pnpm test:db`: exit 0; **2 files, 23 tests passed**. These apply all three migrations through PGlite; they do not claim native concurrency coverage. Total: **52 tests, 0 failures**.

Separately, all three migrations were applied to a dedicated native local PostgreSQL database. Actual browser registration, store creation, synthetic connection, worker imports, product selection and logout/resume used native PostgreSQL. Fixture seed also completed: six demo orders, seven lines and ten independent readings. No native PostgreSQL blocker occurred; concurrent production deployment/worker acceptance remains separate.

## 11. pnpm build

`pnpm build`: exit 0. Next.js 16.3.1 webpack production build compiled, completed TypeScript checks, page generation and build traces. Routes include public `/`, `/sign-in`, `/sign-up`, protected operations and all existing onboarding steps. Development account providers are deliberately unavailable in a production runtime.

## 12. Manual journey / responsive verification

Actual local browser at 1440px, 768px and 390px: Landing and sign-up inspected; imported Products inspected at all widths. Mobile Store/Etsy/Setup boundary inspected. Width measurements for Landing and Products matched viewport (no horizontal overflow); no sidebar on entry/auth/onboarding, no cream/green theme, no duplicated navigation or concatenated label/value presentation was observed. Screenshots are under `docs/screenshots/entry-*`. Visual acceptance still belongs to the product owner.

Journey verified: logged-out Landing → sign-up → persisted account/Auth.js session → Store → Etsy → synthetic shop connection/worker import → two selected products → existing Setup boundary. Logged-out Orders/Products/Settings/Store-onboarding redirected to sign-in. Incomplete `/orders` redirected to Setup boundary. Logout returned Landing; email sign-in resumed Etsy before connection, then Setup after selection. Native database counts immediately before/after logout remained **1 user, 1 organization, 1 store, 1 connection, 2 selections, 6 orders**. A seeded explicitly completed demo seller signed in to Home; `/onboarding` returned Home without a loop. The completed seller also followed Home → Settings → Sign out → public Landing using the shared tested action. After a server restart, email sign-in again resumed the persisted Setup boundary and its shared logout returned Landing.

A redirected browser navigation produced one opaque `Origin: null` action request, which Next.js correctly rejected. Reloading the page restored normal same-origin logout. Origin checks were not weakened. Stale cookies from a separately keyed local run were rejected before the new account session replaced them. These are recorded rather than hidden as successful requests.

## 13. Remaining production auth limitations

Production email self-service is intentionally unavailable: verification, password recovery/reset, login/registration abuse controls and account lifecycle/IdP policy are not implemented. Production needs configured real GitHub OAuth (not manually authorized without credentials), correctly managed secrets, HTTPS/session policy and deployment review. No Google authentication exists. JWT logout ends the current session; cross-device/session revocation is future auth policy work. Live Etsy authorization was not exercised here; live intake remains gated pending approved response-contract verification and never substitutes demo data.

## 14. Recommended next task

**PRODUCT CONFIGURATION SYSTEM / PRODUCT SETUP.** Plan/implement real per-product configuration and explicit validated completion using the existing selected-product boundary. This task stopped at the boundary; it did not implement Product Setup, seller style, AI/model requests, PDF, delivery, billing or new infrastructure.
