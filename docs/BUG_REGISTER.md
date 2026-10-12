# Bug register

## UI-UX-01 — Connect Etsy onboarding

**Status: IMPLEMENTED** (2026-10-12)

Step 2 retains the Setup Guide's operational purpose: connect the Etsy shop, choose products, then complete reading configuration. A single connection card presents the actual connection state and primary action first. The two permission boxes are replaced by compact access/responsibility copy and expandable disconnect guidance. Connected sellers receive a clear Products continuation; expired/reauthorization presentation retains Reconnect Etsy. Authorization failure preserves the existing alert, retry and any already-connected state. Existing form pending labels, error handling, demo distinction, ownership checks, OAuth actions, scopes, redirects and setup progress are unchanged.

Styling is scoped to Step 2 and reuses existing onboarding tokens and shared controls, with full-width mobile actions, wrapping text and reduced horizontal padding.

Verification evidence:
- `pnpm test tests/onboarding-etsy-ui.test.ts tests/onboarding.test.ts tests/onboarding-navigation.test.ts tests/setup-progress.test.ts tests/entry.test.ts`: 30 tests passed.
- `pnpm typecheck --incremental false`: passed.
- `git diff --check`: passed.

**Not marked VERIFIED:** automated page rendering/state coverage is not live OAuth acceptance or responsive browser/visual verification. No live Etsy calls, OAuth connection changes, database/schema changes, commit, push or deployment were performed.

This register was absent in the inspected checkout; this entry does not reconstruct unrelated historical issues.

## BUG-001 — Etsy Catalog Onboarding Refresh

**Status: IMPLEMENTED** (2026-10-12)

Confirmed the reported early return: `retryImportAction()` returned its `hasMore` message before `revalidatePath('/onboarding/products')`. Successful partial batches now retain their feedback and reach revalidation before returning. Persisted batches reporting issues also refresh while retaining the existing error message. Fixture job behavior, authorization, catalog synchronization, scopes, selections and redirects are unchanged.

Automated evidence: focused action regressions cover partial/terminal batches, persisted failure feedback, exception sanitization and the fixture retry path. No live catalog synchronization was performed.

## UI-UX-02 — Reading Details Workspace

**Status: IMPLEMENTED** (2026-10-12)

Existing Reading Details dialogs now separate customer information, reading progress, attention conditions and preparation/customer-information controls. Current output links to Review Workspace when existing admission permits it. Stale input warnings remain explicit; raw revision/queue labels are removed from the primary information view. No generated-content editor, new route, generation path or mutation capability was introduced. Existing customer-information correction controls remain separate; generated reading content is edited/approved only in Review Workspace.

Display labels resolve from the Reading's immutable bound ProductVersion. An exact retained Etsy question-ID/property/listing mapping may use the original purchased question label. Missing/ambiguous evidence preserves existing labels rather than borrowing current catalog definitions. Stored answer keys, values, order and purchased snapshots are unchanged; admission and InputEditor continue receiving the original answers.

Automated evidence: label preservation/ambiguity/purchased-label cases, read-only escaped detail rendering, current/stale output, independent purchase lines, existing Orders/Review links and responsive CSS contracts. Authenticated browser interaction and visual/mobile verification were not performed.

## UI-UX-03 — Profile & Style Navigation

**Status: IMPLEMENTED** (2026-10-12)

Your Profile & Style now immediately follows PDF Appearance in the existing sidebar. The existing profile route `/settings/profile`, nested previous-work routes and profile/style functionality are retained. PDF Appearance keeps `/pdf-studio` and its existing PDF-design aliases. Profile routes highlight only Profile & Style, while Settings remains active for its own routes. Existing Deliveries navigation is preserved.

Automated evidence: sidebar destination/order and nested active-route regressions, existing profile/style workflow tests and application-shell rendering.

## Continuation verification

- `pnpm test tests/onboarding-catalog-retry.test.ts tests/reading-details-labels.test.ts tests/application-shell.test.ts tests/orders-refinement.test.ts tests/review-orders.test.ts tests/onboarding-navigation.test.ts tests/onboarding-etsy-ui.test.ts tests/style-workflow.test.ts tests/deliveries-workspace.test.ts`: **74 passed**.
- `pnpm typecheck --incremental false`: **passed**.
- `git diff --check`: **passed**.

All four items are IMPLEMENTED; automated checks do not claim live Etsy, native application-database, authenticated browser or production verification. UI-UX-01 was not redone. No application database access, migrations, live Etsy calls, commit, push or deployment occurred.
