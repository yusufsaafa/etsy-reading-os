# Milestone 5.4 — Product Configuration workspace

## Recovery and scope

Recovered the existing uncommitted implementation on `codex/ui-ux-design-lock`, starting at `63cd13102f14033424d34348772f018e26a9b84c`. Existing work was retained and completed, not restarted. No schema migration, live Etsy request, synchronization, AI dispatch, development-database write, push or deployment was performed.

## Implemented

The canonical Product workspace is `/products/<Product UUID>/configuration`. Numeric `/products/<listing ID>` remains Listing Detail. Legacy Product Setup and operational PDF Appearance links redirect into the workspace, preserving validated listing/choice and Products return context. Onboarding retains its existing editor and design-assignment workflow.

| Tab | Working content |
| --- | --- |
| Overview | Product name, preparation mode/target, output, resolved PDF design and publication evidence; navigation to editable areas and Store profile/style |
| Product Setup | Existing exact choice selection, TEXT/LONG_TEXT/DATE inputs, requiredness, personalization mappings, section names/instructions and ordering |
| Generation Settings | Existing Manual/Assisted modes, target duration and TEXT/PDF output |
| PDF Appearance | Existing Product override or Store default resolution, separate assignment command and real PDF Studio preview links |
| Readiness | Existing setup/publication validation evidence and corrective links; explicitly not comprehensive runtime readiness |

One mounted editor owns the ProductVersion draft across Setup and Generation. Tab changes retain unsaved inputs and update browser history. Save uses the existing expected revision; Publish is one explicit header action targeting that same form. Changing the draft binding remounts the editor with the correct version. Published versions remain immutable. Internal departure warns about unsaved changes; separate PDF assignment also requests explicit continuation when the Product draft is dirty. PDF assignment never publishes the ProductVersion.

Context is derived from authorized saved mappings, preferring the requested exact association or the configuration's canonical policy. Shared Products are identified without assuming every associated choice matches their publication policy. Stale, partial or wrong-Product choice evidence is not presented as verified current context. Return paths preserve Products search, section, Etsy state, setup filter, sort, page and page size while rejecting external destinations.

Listing Detail uses compact operational rows, concise setup badges, inline dimension/value relationships and adjacent shared InformationPopover disclosures. Ordinary two-dimension fixture rows measured 69–70px at 1440px. All dimensions remain visible; long text expands naturally. Configured rows use neutral configuration navigation; incomplete rows use blue corrective actions. Unknown inventory and previously configured options remain separate. Coverage and PDF resolution semantics are unchanged.

## Authorization and bounded reads

The route validates Product UUIDs, resolves the authenticated store server-side, and uses persisted membership checks. Product, current active/draft versions and mappings are store-scoped. Only owners receive write controls; members can inspect disabled configuration fields. Existing save, publish and document commands still authorize writes server-side.

The new workspace read loads one owned Product, at most two current versions and at most 101 mappings (100 displayed plus an explicit overflow indication). Listing associations and PDF summaries reuse the existing bounded catalog projection. No historical order scan, automatic Etsy request or new configuration model was added. Exact `etsy-selection/1`, pinned ProductVersions, purchase snapshots, generation identity and immutable document snapshots remain unchanged.

## Tested

| Check | Result |
| --- | --- |
| `pnpm test` | 931 tests passed, 90 files |
| `pnpm test:db` | 522 tests passed, 26 files; isolated PGlite databases |
| `pnpm typecheck` | Passed |
| `NEXT_TELEMETRY_DISABLED=1 pnpm build` | Passed |
| `git diff --check` | Passed |
| Lint | No lint script configured |

Focused tests cover shared editor payload/revision, draft save/publication immutability, stale-write rejection, owner/read-only behavior, owned association selection, invalid explicit design, safe navigation, exact context, absence of automatic provider calls and cancellation/continuation of unsaved-draft PDF assignment. Existing Orders, generation, catalog, publication and document regression suites passed.

## Browser acceptance

Actual production components and ApplicationFrame/CSS were rendered in an isolated local fixture harness. Fixtures use fictional data, local SVG imagery and mocked commands; external API requests are blocked. This is rendered-component acceptance, not authenticated real-store end-to-end acceptance.

Desktop 1440px, tablet 768px and mobile 390px were inspected for Listing Detail (six mixed configured/incomplete choices) and all five configuration tabs. Document width matched viewport width; no page-level horizontal overflow was observed. Forms align, tabs wrap, mobile options stack, labels and primary actions remain visible. Additional mobile unknown-inventory, long-label, read-only and warning-popover states were inspected. Enter opens the setup disclosure; Escape closes it and returns focus to its trigger. Back/Forward between tabs retained an unsaved Product name.

The browser control session stalled when opening the native PDF-assignment confirmation. End-to-end dismissal/submission of that confirmation is **NOT VERIFIED** in the browser. Its actual capture handler's cancellation and continuation behavior is covered by focused unit tests. No live assignment was submitted.

Figma comparison: **NOT VERIFIED**. Figma was deliberately not accessed, as instructed. Authenticated real-store navigation/publication and actual PDF preview rendering in this workspace were not exercised; their existing service/database/renderer regression tests passed.

### Screenshots

| Screen | Desktop | Tablet | Mobile |
| --- | --- | --- | --- |
| Six mixed options | [Desktop](acceptance/milestone5_4/listing-six-mixed-desktop.png) | [Tablet](acceptance/milestone5_4/listing-six-mixed-tablet.png) | [Mobile](acceptance/milestone5_4/listing-six-mixed-mobile.png) |
| Overview | [Desktop](acceptance/milestone5_4/configuration-overview-desktop.png) | [Tablet](acceptance/milestone5_4/configuration-overview-tablet.png) | [Mobile](acceptance/milestone5_4/configuration-overview-mobile.png) |
| Product Setup | [Desktop](acceptance/milestone5_4/configuration-setup-desktop.png) | [Tablet](acceptance/milestone5_4/configuration-setup-tablet.png) | [Mobile](acceptance/milestone5_4/configuration-setup-mobile.png) |
| Generation | [Desktop](acceptance/milestone5_4/configuration-generation-desktop.png) | [Tablet](acceptance/milestone5_4/configuration-generation-tablet.png) | [Mobile](acceptance/milestone5_4/configuration-generation-mobile.png) |
| PDF Appearance | [Desktop](acceptance/milestone5_4/configuration-pdf-desktop.png) | [Tablet](acceptance/milestone5_4/configuration-pdf-tablet.png) | [Mobile](acceptance/milestone5_4/configuration-pdf-mobile.png) |
| Readiness | [Desktop](acceptance/milestone5_4/configuration-readiness-desktop.png) | [Tablet](acceptance/milestone5_4/configuration-readiness-tablet.png) | [Mobile](acceptance/milestone5_4/configuration-readiness-mobile.png) |

Additional evidence: [mobile warning](acceptance/milestone5_4/listing-warning-mobile.png), [unknown inventory](acceptance/milestone5_4/listing-unknown-mobile.png), [long labels](acceptance/milestone5_4/listing-long-labels-mobile.png), [read-only Setup](acceptance/milestone5_4/configuration-readonly-mobile.png).

## Known limitations

Comprehensive runtime readiness is deferred to 5.5. Reader/style selection remains Store-level. Shared Product associations do not override exact publication policy. Catalog verification and existing choice/mapping bounds still apply. More than 100 Product associations are explicitly disclosed. Preview uses the existing owner-only PDF Studio; it does not embed a second renderer. Native browser unsaved-assignment confirmation and authenticated real-store end-to-end behavior remain unverified as described above.

## Changed source and tests

- `src/app/(operations)/products/[id]/configuration/page.tsx`
- `src/app/(operations)/products/[id]/setup/page.tsx`
- `src/app/(store-setup)/products/[id]/document-design/{page.tsx,actions.ts}`
- `src/components/products/{configuration.tsx,configuration-workspace.tsx,configuration-workspace.module.css,configuration-pdf.tsx}`
- `src/components/products/{editor.tsx,setup.tsx,setup.module.css,listing-detail.tsx,listing-detail.module.css}`
- `src/modules/products/{workspace.ts,workspace-navigation.ts}`
- `tests/{product-workspace.test.ts,product-workspace-loader.test.ts,product-workspace-unsaved.test.ts,product-field-interaction.test.ts,products.db.test.ts,listing-detail.test.ts}`
- README, Product configuration documentation, Listing Detail documentation, this report and screenshot evidence.

Generated `next-env.d.ts` and `tsconfig.json` changes are excluded from the milestone commit.
