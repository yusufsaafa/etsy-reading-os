# Milestone 5.4.1 — Exact choice configuration navigation

## Verified cause and correction

Unconnected choices previously linked to `/onboarding/products/setup?listing=…`, without the selected canonical choice. The onboarding layout and setup page redirect completed stores to their operational destination (Dashboard), so ordinary configuration never reached the setup editor.

The operational entry is now `/products/<Etsy listing ID>/configure?choice=<etsy-selection/1 key>&returnTo=<validated Products URL>`. GET performs a bounded authorized saved-catalog read only. It shows the exact choice, cancellation/return links and an explicit **Create draft configuration** action. It does not create a Product, request Etsy data or publish a configuration.

The owner-only server action uses `beginCatalogChoiceDraft`, which verifies persisted membership, locks the authorized Store, checks the current Etsy shop identity and saved inventory revision, and resolves the exact mapping. Existing owned Products, including drafts, are reused. Otherwise it delegates to the existing `beginEtsyProductDraft` service. The resulting Product UUID opens the existing five-tab configuration workspace, preserving listing, canonical choice and Products filter context. Repeated submission reuses the same association and does not overwrite an existing draft.

Products List warning and management links, Listing Detail actions, and the catalog read contract now use the operational entry/canonical workspace. Legacy configuration routes remain available. Safe return navigation retains supported search, section, status, setup, sort, page and page-size parameters; external or malformed return destinations fall back to Products.

## Evidence and security boundaries

- Unknown, stale, failed or unsupported inventory cannot create a fabricated choice. Saved mappings remain distinct from verified current inventory.
- An invalid association shows a recoverable explanation and review navigation; no replacement is guessed or created automatically.
- Read-only members can inspect evidence but cannot initiate creation. Writes recheck persisted owner authorization and Store ownership server-side.
- Existing active-listing creation restrictions and exact ACTIVE ProductVersion publication validation remain authoritative. Draft creation is not publication or production readiness.
- No schema, historical purchase fingerprint, FulfillmentUnit, generation admission, PDF assignment hierarchy, artifact or snapshot behavior changes.
- Reads and creation use saved bounded catalog evidence; no external calls are added. Explicit later publication retains the existing source validation workflow.

## Listing Detail density

All purchase dimensions remain visible as compact value lines. Dimension labels and canonical identity are available in the existing accessible InformationPopover and screen-reader text. Purchase identity controls stay alongside those values; setup explanation controls stay beside their badges. Desktop columns reserve sufficient width for setup status and actions, without fixed row heights or clipped labels.

The isolated browser fixture renders the real application components with six two-dimensional choices (Delivery × Reading Detail), three configured choices sharing one Product and three unconnected choices. Desktop rows measured **70, 69, 70, 69, 70, 69px** at 1440px. Tablet (768px) and mobile (390px) use compact stacked records. Document width matched each viewport; no horizontal page overflow was observed. Keyboard/tap disclosure and dismissal were inspected. Products List → Listing Detail → unconnected Configure and existing Product configuration navigation were exercised without creating or publishing real Products.

## Validation and limitations

- Unit suite: 938 tests passed across 92 files.
- Database suite: 524 tests passed across 26 files using isolated PGlite databases; no configured development database writes.
- Typecheck and production build passed; generated Next.js tooling changes were excluded.
- No lint script is configured.
- Tests cover explicit creation and idempotency, draft preservation, distinct canonical identities with duplicate labels, stale inventory, owner/read-only access, cross-store rejection, safe return navigation and existing publication regressions.
- Browser acceptance is **fixture acceptance**, not authenticated real-store acceptance. No development database mutation, live Etsy request, sync or AI dispatch was performed.
- Figma comparison: **NOT VERIFIED**; Figma was not accessed.
- Invalid associations require owner review through existing management workflows; this milestone does not introduce an automatic repair engine.
- Comprehensive runtime Readiness remains outside this milestone.

## Screenshots

| View | Desktop | Tablet | Mobile |
|---|---|---|---|
| Six mixed purchase options | [1440px](acceptance/milestone5_4_1/listing-desktop.png) | [768px](acceptance/milestone5_4_1/listing-tablet.png) | [390px](acceptance/milestone5_4_1/listing-mobile.png) |
| Unconnected choice entry | [1440px](acceptance/milestone5_4_1/configure-unconnected-desktop.png) | [768px](acceptance/milestone5_4_1/configure-unconnected-tablet.png) | [390px](acceptance/milestone5_4_1/configure-unconnected-mobile.png) |

Additional evidence: [existing Product workspace](acceptance/milestone5_4_1/configure-existing-desktop.png), [mobile choice disclosure](acceptance/milestone5_4_1/choice-disclosure-mobile.png).

## Changed source and test files

- `src/app/(operations)/products/[id]/configure/{page.tsx,actions.ts}`
- `src/components/products/{choice-setup.tsx,choice-setup-form.tsx,catalog-list.tsx,listing-detail.tsx,listing-detail.module.css}`
- `src/modules/products/{catalog-setup.ts,workspace-navigation.ts}`
- `src/modules/catalog/read.ts`
- `tests/{choice-setup.test.ts,choice-setup-action.test.ts,catalog.db.test.ts,products-list.test.ts,product-pdf-navigation.test.ts}`
- `README.md`, this report and eight fixture screenshots under `docs/acceptance/milestone5_4_1/`.
