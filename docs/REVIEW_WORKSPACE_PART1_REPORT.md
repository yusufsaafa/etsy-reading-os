# Review Workspace Part 1 report

Branch codex/ui-ux-design-lock; starting commit ab2d81954d2ecb802566deb95310f90ab2b63e5e. Ending SHA is reported in the task response.

Files: src/modules/review/service.ts; src/components/review-reading.tsx; src/app/(operations)/orders/[id]/readings/[readingId]/review/page.tsx; Orders list/detail pages; reading-preparation.tsx; globals.css; db/schema.ts; migration 0013_flat_prodigy and Drizzle journal/snapshot; review and Orders render tests; generation DB review integration tests; REVIEW_WORKSPACE.md and this report.

A narrow reading_reviews entity has one PENDING review per owned Reading and pins exactly one successful Generation. No edited-content blob or approval/document states are invented. The original canonical result remains immutable evidence. Lazy first-entry admission under the Store lock avoids historical backfill and duplicate pins. Composite owned Reading/Generation foreign keys and immutable-base trigger protect provenance. See REVIEW_WORKSPACE.md for eligibility and the existing QUEUED-intent distinction.

Route /orders/[id]/readings/[readingId]/review derives authenticated scope server-side. Orders shows Ready for review and Review reading only after durable eligibility. Customer name, order reference and product identify the task; frozen context supplies labelled customer answers, including optional/long values. Exact product-order canonical sections render in a 72ch column with preserved paragraph breaks. No internal section/generation/provider/accounting metadata, editing or approval controls. Primary navigation unchanged.

Mixed carts and quantity units have independent review bases. Quantity uses Reading n of quantity in operational UI only. Cross-organization/sibling Store and forged Order/Reading relationships fail closed. Corrupt/missing/inconsistent reading evidence cannot be admitted; the route uses the existing safe not-found behavior. A later successful preparation cannot replace the existing pin; active/problem states can block display without altering provenance.

Mobile/accessibility: existing shell/header patterns, width-safe details grid, long-string wrapping, semantic headings/article/sections, text status and normal keyboard links. Verified by render/structure tests; native browser viewport QA is not claimed.

Tests add strict canonical/context failure coverage, exact labels/order, optional/long answers, escaped rendering, metadata/control exclusion, Orders eligibility actions, concurrency, immutable original/base, later evidence, quantity/mixed carts, tenant and sibling Store isolation, production attention and corrupt persistence. Existing production/generation/style suites remain active. All new preparation fixtures use the fake provider; review operations import no provider execution path. No real Gemini calls.

Editing, approval, regeneration, PDFs, delivery and Parts 2–4 are not implemented. No Style Intelligence/provider/orchestration behavior changed. Nothing pushed or deployed.

Final validation: pnpm typecheck PASS; pnpm test 140 tests/21 files PASS; pnpm test:db 263 tests/11 files PASS; total 403 tests/32 files. pnpm build PASS; git diff --check PASS. Migration replay from scratch and repeat no-op passed in the existing migration suite; historical production/accounting fixtures remain preserved. Initial fixture failures corrected required sibling Store import date and terminal queue claim metadata, and the later-generation fixture uses persistence rather than implementing unsupported regeneration. Build-generated Next TypeScript file changes were restored and typecheck passed afterward. Native viewport QA remains unclaimed. Final git status is reported after commit.
