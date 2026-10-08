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

## Product Seller UI MVP Part 1 (2026-10-08)

Starting commit: 4e610040caea26c6f779a4b572773caa7efe3fc3. Step 2 now navigates real connected Stores to /onboarding/products without enqueuing general order sync. Step 3 uses a dedicated listing-only server read and the existing owned connection/vault/refresh flow; the gated live intake adapter and receipt path remain unchanged. Official getListingsByShop (https://developers.etsy.com/documentation/reference) supports listings_r, state and limit/offset; https://developers.etsy.com/documentation/essentials/urlsyntax/ documents pagination/count. Discovery reads active, inactive, sold_out, draft and expired listings, 100 per page, with ownership checks, 15-second per-request timeout, 1 MiB page limit, 10,000 total listing cap and explicit failure on incomplete/duplicate/mismatched evidence. IDs use the existing precision-preserving JSON parser. No arbitrary URLs, buyer data, images or personalization definitions are requested. Persisted listing snapshots are minimal discovery projections, not complete listing definitions or purchased-input evidence; Step 4 must obtain verified setup evidence separately.

The existing compact picker adds status filtering, search, selected count and Configured / Needs setup / Not selected states. Neutral thumbnails follow the locked design (no verified images in the canonical listing projection). Selection retains the existing 1,000-listing command bound. Only active listings may continue; previously selected unavailable listings remain visible and can be deselected. Hidden listing identities serve the existing authorized save command, not seller-visible technical labels. Selection is saved through listing_selections under Store lock and advances to the existing Step 4 surface. Discovery/selection never creates Products, activates incomplete versions, fabricates mappings or enables order intake. Existing mapping/version associations remain untouched; configured variants are recognized by owned active Product association. Fixture Stores retain their explicit development path; real Stores never fall back to fixtures. Failures show reconnect/retry text, no raw API errors; existing route loading boundary applies.

Focused validation: 12 unit/render tests and 16 DB tests passed; full unit suite: 449 tests across 39 files passed; typecheck, production build and diff check passed. No new schema/migration. Initial new DB fixtures omitted required synthetic user names; corrected before passing. Tests cover owned/disconnected/foreign Store access, pagination, int64 preservation, bounded schema/response failure, no fixture fallback, unchanged Product counts, configuration association, idempotent selection and setup navigation. UI HTML render assertions complement domain tests; no interactive real-browser pass is claimed.

Controlled MRH check: local owned Store lookup succeeded, but the configured native database has no products or product_versions tables (existing migration0003 prerequisites). The bounded check stopped before Etsy requests: **0 Etsy requests**, no grant refresh and no business-record changes. Real display acceptance is BLOCKED on bringing this local database onto the established migration history, then opening Step 3 in the authenticated browser. No raw identities, grants, titles, customer data or secrets were emitted. Temporary check script removed. No accepted ledger item changed; this does not accept Etsy order intake/cardinality or buyer-input support. Step 4's stable option/question mappings and historical policy remain the next separately authorized UI milestone.


## Product selection polish — 2026-10-08

Step 3 requests `includes=Images` within the existing owned shop-listing pages; no per-listing request, order read or Etsy write is introduced. Primary image is the lowest-rank image's `url_75x75`. Only credential-free HTTPS public `i.etsystatic.com` / `img<number>.etsystatic.com` URLs without query/fragment/port are exposed. Next Image uses unoptimized public CDN loading with no referrer; the application does not proxy arbitrary resources or persist binaries. Missing/unusable images and image load errors fall back to the neutral placeholder. The canonical persisted Listing contract remains unchanged; thumbnail is ephemeral discovery presentation data.

The default local filter is All. Compact status chips/counts derive from the full discovered collection. Search/status filtering precede local eight-row pagination and reset to page one; bounded page-number controls keep large collections compact. Selection is independent of the current page/search/filter, with explicit Select page / Deselect page commands limited to visible rows. Only active listings may be newly selected; the existing server-owned selection/activation boundaries remain unchanged. Browsing does not create Products or ProductVersions. No migration.

Automated validation: 18 focused unit tests and 5 focused DB tests passed; typecheck, production build and diff check passed. Unit coverage includes safe/missing thumbnail, actual counts, filtering/search composition, eight-row/four-row final pagination, identity uniqueness and page-only selection preserving hidden selections. Existing DB coverage verifies repeated discovery/selection and tenant isolation without creating/activating products.

Manual local MRH check: real thumbnails visibly rendered through the existing grant. All (28), Active (26), Inactive (2), eight rows on pages one/two, four rows on page four, and unchanged selected count across page navigation and status filtering were verified; the inactive filter displayed two disabled rows and reset to its first page. This is manual browser evidence, separate from automated acceptance. No receipt/customer API read, Etsy mutation, Step 4 configuration, push or deployment occurred. Generated Next tooling changes are excluded.

Official API authority: https://developers.etsy.com/documentation/reference/ (`getListingsByShop` Images association and ListingImage rank/url_75x75). This changes discovery presentation only; no other acceptance ledger debt is closed.


## Etsy setup catalog prerequisite — 2026-10-08

This is the prerequisite chooser, not Product UI Part 2 redesign. Real Etsy selection enters a read-only owned catalog before any draft creation. The minimal Step 4 route shows source title/thumbnail, actual purchase choices and supported text definitions. The seller explicitly selects one complete configuration; POST uses `beginEtsyProductDraft` through fresh server verification. Legacy fixture setup remains available only for fixture Stores. Viewing or retrying the catalog creates nothing. Unsupported or unavailable evidence shows a controlled setup-blocked state with no draft form.

Draft behavior, content and customer-field mappings remain seller decisions. The current editor cannot yet author source question mappings; activation blocks incomplete mappings rather than fabricating them. Product UI Part 2 will provide that workspace separately. No new schema/migration, Product system, per-option behavior override, order ingestion or generation was added.

Validation: 40 focused unit/render tests across six files and 28 focused DB tests across three files passed. Typecheck, production build and git diff --check passed. New coverage comprises 16 catalog/chooser unit tests and six catalog DB tests; the rest exercises existing discovery, selection, onboarding and Product behavior. Local MRH service acceptance verified four concrete configurations, two dimensions, two supported text questions and a primary thumbnail. Repeated reads created nothing; explicit draft and replay retained one canonical inactive draft with exact source identities. This is service evidence, not a claim that the redesigned seller setup UI exists. Known generated Next tooling changes are preserved and excluded from the commit.

## Product Seller UI — MVP Part 2 (2026-10-08)

Starting HEAD: `68b31e95acf0419bdebedca1f63c19f51a669be8`. Local Mac checkout, existing MRH Store/grant and drafts retained. No schema/migration or Product mapping architecture change.

### Navigation repair

Both reported failures occurred before the action reached Product/selection logic. Native Safari forms under global no-referrer sent `Origin: null`; Next rejected the mismatch with the forwarded tunnel host. Next development logs also recorded blocked JS/HMR resources because config retained a prior temporary hostname. A development-only environment-driven exact host allowlist and same-origin referrer policy on onboarding restore hydration/native forms without disabling origin validation or changing production trust. Step 3 already saves owned selections then redirects; that domain path is retained.

Step 4 additionally only looked up legacy default bindings. It now resolves canonical source-aware drafts and links to the existing in-route product editor, without another creation command. An Etsy draft loads verified current setup catalog data and checks its canonical binding/configuration. Missing draft/catalog/source changes produce controlled retry/back states rather than a blank page. Explicit choice creation remains through beginEtsyProductDraft with existing idempotency/Store authorization. Legacy drafts are neither deleted nor silently converted.

### Seller UX

Step 3 groups search and status chips in a cohesive toolbar. Actual counts, eight-row pages, page-only selection and inactive restrictions remain unchanged. Etsy state has a subordinate dot/outlined-dot and explicit label. Selection has its own checkbox/background/border affordance. Setup required uses a neutral amber disclosure supporting hover, focus, keyboard and touch; its accessible label contains the explanation. Pagination controls are centered independently from the range label.

Step 4 list/editor use the existing safe primary images and identity-derived Etsy external links (new tab, noopener/noreferrer, image-load fallback). Existing discovery refresh supplies list presentation; individual catalog reads supply current source setup. The local editor workspace has a main form and contextual non-chat guidance, stacking at narrow widths without changing the global shell.

One complete verified purchase configuration is pinned per Product. The editor reviews all concrete catalog configurations and offers explicit setup of another choice through the existing chooser. No per-option overrides, label/SKU interpretation or merge/bulk semantics are introduced. Customer fields are created by seller action; each supported Etsy text question must be explicitly mapped by stable question identity to a distinct input key. Example field buttons create fields only and never infer mappings. Deleting a field removes its mapping. Required unmapped fields and changed/unsupported questions block activation. Current definitions cannot reinterpret historical purchases.

Reading sections can be added, edited, removed and reordered within existing limits. Supported output choices are text/PDF; preparation is Manual/Assisted with truthful review/approval and separate Etsy-delivery copy. Preparation presets persist 60/360/1440/2880 minutes; Custom uses hours/days and validates positive whole-minute duration up to 525600 minutes. Priority remains the existing version-owned queue choice, not an Etsy-label inference. Save draft is incomplete-friendly, revision-fenced and replay-safe. Activation retains server schema, catalog, mapping and domain gates. Unsaved navigation prompts before discarding work; saved drafts are durable across revisits. No browser local-storage copy of configuration is added.

The existing pure activation readiness checks were separated into a browser-safe module; server runtime schema validation still precedes them. This fixed a build-detected server crypto dependency crossing the new client boundary. No provider/model operation is introduced.

### Validation and real browser evidence

Automated: 60 focused unit/render/action/route tests across nine files passed; 40 focused DB tests across four files passed. Coverage includes selection persistence/redirect, development-versus-production origin policy, controlled setup failures, exact existing draft/catalog resolution, supported question mapping and drift holds, duration presets/bounds, safe links/images, disclosure semantics, section/output/preparation rendering, source-aware save/replay and tenant isolation. PGlite coverage is regression evidence, not a new native PostgreSQL acceptance claim. Typecheck, production webpack build and git diff --check passed. No migration.

Real local Safari evidence: Step 3 showed 28 owned MRH listings and one existing selection. Clicking Continue reached Step 4 without manually entering its URL; Continue setup opened the same canonical draft. Back navigation returned to the setup list. Real source thumbnail and canonical external Etsy link were observed in the list; the redesigned editor's accessibility tree exposed four actual purchase choices, two text questions, mapping controls, section/output/preparation controls and all time presets. No customer answers were fetched or used. Safe local DB metadata remained three Products, three versions, all DRAFT and zero ACTIVE.

**Full redesigned browser acceptance remains partial.** Subsequent checks were interrupted by active changes to the shared Safari window and ScreenCaptureKit observation failures. A successful real UI draft save, preset/custom interactions, incomplete activation attempt, complete revisit cycle after editing, final Step 3 visual inspection and narrow-screen interaction pass were not verified. Automated render/model/DB results do not replace those checks. No MRH draft was changed or activated for these uncompleted checks. Do not declare the full seller UI acceptance complete until they are exercised in the authenticated local browser. Existing grants and saved drafts are retained; no reconnect was performed.

No orders/receipts, buyer files or customer data were requested; no Etsy mutation, generation, sending, push or deployment occurred. Known next-env.d.ts/tsconfig.json generation noise is preserved and excluded from the milestone commit. ETSY-INPUTS-01, ETSY-E2E-01 and ETSY-CARDINALITY-01 remain OPEN.

The seller subsequently stopped the stalled Safari interaction explicitly. Browser automation was not restarted. The implementation is committed after non-browser gates; the remaining manual acceptance steps above remain NOT VERIFIED.

## Product Setup UX finalization — 2026-10-08

Starting HEAD: 70c24ec3695bf59257ecd06122a95a6bb45a6db9. This final planned MVP refinement changes presentation, not Product semantics.

Each complete catalog purchase choice now shows Not configured, Draft or Active with its own Set up / Continue setup / View setup action. Status is projected from existing Store-authorized mappings, exact canonical property/value combination, matching version policy and the valid ACTIVE pointer. A draft is never called Active. Active describes a published version, not a promise of automatic fulfillment; a paused binding and downstream gates still apply. An active version can coexist with an unpublished edit. Legacy default mappings are not presented as exact source-aware configurations. No records are created by viewing statuses, and creation remains an explicit source-aware command. No labels, SKU, positions or option overrides determine meaning.

A brief three-step explanation precedes choices. Customer Information distinguishes Etsy’s buyer-facing box from the Reading OS field retaining its complete answer. The accessible native disclosure contains clearly illustrative HTML examples: one combined answer maps intact to one long-answer Customer context field; three distinct boxes map explicitly to three distinct fields. No automatic person/date extraction, actual customer values or fake screenshots are used. A seller-clicked Customer context shortcut creates a LONG_TEXT field only; it never guesses a question mapping.

Existing customer fields appear as compact summary rows with one editable field at a time. Type descriptions use Short answer / Long answer / Date while retaining TEXT / LONG_TEXT / DATE. Opening/collapsing preserves label, required flag, help text, stable key and mapping; reorder/remove and existing revision-fenced save remain available. Date still requires a structured answer and never parses a combined text response. Reading content now asks “What should this reading cover?” with illustrative topics clearly separated from buyer questions.

The live checklist groups existing readiness issues into seller tasks, shows complete/action-needed text, and links/focuses the corresponding section. Exact validation details remain available and actual server errors remain visible. Checklist links bypass the unsaved-leave prompt because they stay within the editor. Incomplete activation is prevented locally and still independently validated server-side; unfinished Save draft remains available. Green active and gray inactive Etsy dots with readable labels are shared across discovery, lists, choice source summaries and the editor. Local breadcrumb/back presentation is consistent; the global shell is unchanged.

Validation: focused unit/render/controlled-interaction tests cover exact per-choice state, one/multi-box guidance, explicit long-answer mapping, edit/collapse/reorder/remove preservation, format descriptions, checklist transitions/navigation, incomplete activation, status labels and back links. Focused PGlite tests cover persisted draft/active distinction, source-aware replay, tenant isolation, existing activation gates and retained configuration. No production domain/schema/migration changes or new dependencies.

Real MRH acceptance for these final refinements is **NOT VERIFIED**. Safari automation remains stopped at the seller’s prior request; no new browser acceptance or real Etsy calls were performed. Prior milestone browser evidence remains partial and is not upgraded by automated tests. Manual checks still required: actual configuration statuses, disclosure examples, one combined box to one long field, field edit/save/reopen, live checklist/navigation, incomplete activation and mobile layout. Do not activate a real Product merely for this UX check. Existing local Store/grant/drafts were not changed by this milestone. No receipt ingestion, generation, customer-file read, Etsy mutation, push or deployment.

Final non-browser results: **50 focused unit/render/controlled-interaction tests across eight files**, **36 focused DB tests across three files**, typecheck, production build and git diff --check PASS. An initial DB test run found an alias import unsupported by the DB runner; the projection import was made relative and affected/combined DB checks passed. A parallel typecheck overlapped build regeneration of .next types and failed on disappearing generated files; sequential typecheck after the successful build passed without altering TypeScript settings. No failures were suppressed. Known next-env.d.ts/tsconfig.json tooling noise is preserved outside the commit. No schema/migration changes.
