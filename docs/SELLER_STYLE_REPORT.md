# Seller identity + style library implementation report

Branch: `codex/ui-ux-design-lock`. Parent: `802058412e0066fb26799edff9de48fbd9a96a9a`. Date: 2026-10-05.

## Implemented

One SellerProfile and one stable StyleProfile per Store, with structured version-owned style and optional immutable pasted references. Four additive tables separate identity metadata, style identity/pointer, immutable published versions and independently managed reference material. No new dependencies or object-store adapter. Store/ProductVersion/Customer Context remain separate concerns; Order → LineItem → FulfillmentUnit is unchanged.

Migration `0004_tense_hammerhead.sql` includes composite ownership constraints, unique store identities/version numbers, partial active/draft indexes, publication/identity immutability, deferred pointer checks and immutable source-content updates. It creates no fabricated seller/style defaults and rewrites no existing product/order history.

Profile saves reuse one row. Style drafts allow incomplete choices and use expected revisions plus exact-payload replay. Publication validates identity/style, atomically archives/activates/changes the pointer, and safely replays. Historical published style versions remain readable. Pasted text has a title, a 50,000-character limit, private scoped reads, SHA-256 digest, replay key and authorized permanent removal. Audits contain actor/action/resource metadata only.

Settings → Your profile & style has compact Profile, Style and Previous work sections using existing tokens and shell. Private text viewing is a separate protected route. Seller copy says Current style / Draft changes / Save changes / Apply style. The primary navigation and Landing/Auth/Home/Orders/Products visual implementation are unchanged.

## Validation

| Command | Result |
| --- | --- |
| pnpm typecheck | Exit 0; full strict check passed, including after restoring unchanged compiler configuration |
| pnpm test | Exit 0; 8 files / 38 tests passed |
| pnpm test:db | Exit 0; 4 files / 58 tests passed |
| pnpm build | Exit 0; optimized webpack compilation, TypeScript, route generation and build traces passed |
| pnpm exec drizzle-kit generate | Exit 0; 21 tables, no pending schema changes |

**96 tests total, zero failures; 22 added (18 database, 4 unit).** All prior 74 tests are retained. New coverage includes unique/reused identity, persistence, forged scopes, operator mutation denial, scoped styles/sources/history, incomplete/stale/replayed draft writes, publication validation, optional bio/reference material, immutable current/history, consistent pointer/one active version, late audit-failure transaction rollback, source replay/conflicting commands/Unicode/bounds/deletion, metadata-only auditing, onboarding compatibility and zero outbound requests from seller/style operations. Existing product version binding, quantity expansion, mixed-cart, intake replay, tenant/auth/OAuth/secret/fencing regressions remain green.

The first added database run exposed an assertion that expected a same-value update to fail; it now tests an actual historical instruction mutation. Published value changes remain rejected. No existing test/security behavior was weakened or removed.

Node 22.23.1 / pnpm 9.7.1. No package or lockfile changes. Next-generated compiler/agent-rule edits are excluded; strict compiler settings are unchanged. Database tests execute all five migrations through PGlite, separately supplemented by native PostgreSQL acceptance.

## Native PostgreSQL and real manual journey

Dedicated local acceptance database, never production:

1. Applied migration 0004 and replayed the migration runner: both exit 0.
2. Ran the existing fixture seed twice: both exit 0, preserving six orders/seven lines/ten readings in the demo store.
3. Captured existing acceptance-store product versions, order identities, unit configuration bindings/issues/revisions and onboarding before profile changes.
4. Signed out the prior synthetic session; signed in to an existing configured seller using genuine Auth.js development credentials.
5. Home remained accessible; Settings retained Store/Etsy/account information and linked Profile & style.
6. Saved Sarah and an optional short bio; reloaded and confirmed persistence. Store name was deliberately preserved.
7. Created a style draft; chose Warm & supportive / Detailed / Conversational, preferred expressions, avoid expressions and additional guidance. Saved and reloaded all fields.
8. Applied the first style. Added a titled synthetic pasted reference with Unicode and literal script-like markup; reloaded the library and opened its private view. Markup rendered as text.
9. Edited style, changed tone to Direct and guidance, saved/reloaded. Native checks confirmed v1 still ACTIVE and unchanged while v2 remained DRAFT.
10. Applied v2. Native context reads confirmed v2 current and v1 ARCHIVED/historically readable with its original Warm configuration.
11. Native service checks using another authorized Store rejected style-version/source reads and could not delete the owner’s source. Audit rows contained no pasted body.
12. Compared original ProductVersion configuration/pointers, all order IDs, all unit bindings/issues/revisions and onboarding: unchanged. Existing store retained two product versions, eight orders and twelve readings.
13. Opened Products: configured Career product remained Active v2; other products remained Setup required. Opened Orders/#2002: one Taylor Reed checkout, Love ×2 + Career ×1, three distinct readings and prior holds preserved.

An additional fresh synthetic Store exercised concurrent native profile saves, draft initialization, same-version publication and source creation: duplicates reused one record. Competing different draft saves at the same revision produced one success and one stale rejection.

No file upload or live Etsy journey was claimed. No production email-auth claim was made; the existing development-only boundary remains.

## Responsive/browser evidence

Actual rendered draft forms were inspected at 1440×960, 768×1024 and 390×844. Document width equaled viewport at each width. Inputs/selects/buttons measured 44px; labels/values remain distinct, controls reflow and navigation uses the existing phone bottom bar. The published style/library and private reference were also inspected; the phone reference had no overflow and escaped Unicode/markup remained readable. Viewport overrides were reset.

Synthetic screenshots: seller-style-1440.png, seller-style-768.png, seller-style-390.png, seller-style-applied-1440.png, seller-style-current-desktop.png, seller-previous-work-390.png under docs/screenshots. Full-page captures can reposition fixed shell elements; the viewport desktop screenshot shows their actual top alignment. Final visual acceptance belongs to the product owner.

## Compatibility, limitations and next work

- Product-based onboarding completion remains unchanged; missing identity/style does not lock completed stores out or alter order readiness. Setup is optional in Settings for now. SELLER_STYLE.md specifies a future explicit new-store onboarding transition and fail-closed generation admission.
- No file/profile-image upload: PrivateObjectStorage currently has only a port. A private adapter, type/signature/size validation, scoped access and retention must precede uploads. No PDF extraction stack was introduced.
- Previous work is stored only, never analyzed. References are immutable while present and permanently removed on deletion. Before generation, define retention and immutable production source snapshots/reference deletion guarantees; historical style lookup alone does not preserve mutable seller metadata or deleted source bodies.
- Library listing is not paginated in this small V1 slice; high-volume/reference selection policy is future work. No multi-reader support or arbitrary taxonomy.
- Live Etsy contract and production authentication/retention/deployment limitations remain unchanged. No AI/model requests, generation, PDF rendering, scheduling, Telegram, billing or delivery.

Recommended next milestone: **LIVE ETSY CONTRACT VERIFICATION / INTAKE HARDENING**, followed by **GENERATION ENGINE + CENTRAL AI GATEWAY + USAGE/COST ACCOUNTING**. Neither is implemented here.

## Files changed

See the exact list below. No dependencies, authentication, Etsy, intake, Product configuration services, order routes or onboarding resolver/service changed.

- `AGENTS.md`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/LOCAL_DEVELOPMENT.md`
- `docs/ONBOARDING_REPORT.md`
- `docs/PRODUCT_SPEC.md`
- `docs/SELLER_STYLE.md`
- `docs/SELLER_STYLE_REPORT.md`
- `docs/UI_UX_DESIGN_LOCK.md`
- `docs/screenshots/seller-previous-work-390.png`
- `docs/screenshots/seller-style-1440.png`
- `docs/screenshots/seller-style-390.png`
- `docs/screenshots/seller-style-768.png`
- `docs/screenshots/seller-style-applied-1440.png`
- `docs/screenshots/seller-style-current-desktop.png`
- `drizzle/0004_tense_hammerhead.sql`
- `drizzle/meta/0004_snapshot.json`
- `drizzle/meta/_journal.json`
- `src/app/(operations)/settings/page.tsx`
- `src/app/(operations)/settings/profile/page.tsx`
- `src/app/(operations)/settings/profile/previous-work/[id]/page.tsx`
- `src/components/seller-style/actions.ts`
- `src/components/seller-style/forms.tsx`
- `src/components/seller-style/profile.module.css`
- `src/db/schema.ts`
- `src/modules/seller-style/context.ts`
- `src/modules/seller-style/contracts.ts`
- `src/modules/seller-style/service.ts`
- `tests/seller-style.db.test.ts`
- `tests/seller-style.test.ts`
