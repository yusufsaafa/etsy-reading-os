# Document / PDF Engine — Part 2 report

Branch: `codex/ui-ux-design-lock`. Starting commit: `55f8f3a26c38c670f458bd73281c7a280b31f9fd`. Ending SHA is reported in the task response; a commit cannot contain its own SHA.

## Architecture and contracts

Part 2 combines approved-reading/v1 and resolved-document-design/v1 into an immutable document-snapshot/v1 semantic input. It does not render or create a PDF. No frontend feature or provider operation is added.

The strict Zod snapshot freezes owned identity; Reading/order/Product identity; order reference/customer and purchased-product display names; Reading number/quantity; exact ordered approved section identities, titles and bodies; approval time/content hash; design identity/revision/name/source; template key/contract/version; exact bounded normalized design configuration/configuration hash; approved Review/Generation provenance; semantic hash and creation time. It contains no customer answers/questions, draft internals, raw Generation result, AI/provider/accounting/style data or arbitrary assets/URLs.

The existing approved-reading/v1 and resolved-document-design/v1 shapes are preserved. Their services expose transaction-composable variants using identical existing validation. Product identity is derived in the Product module from the exact owned Reading/pinned Generation/ProductVersion relationship, selecting identity only. Document body still comes exclusively through the approved-reading handoff.

Templates have retained version definitions independent of current selection. Existing template/config semantics remain unchanged. The schema has no SQL enum restricting future templates to four. Future code can add keys/versions without table redesign; retain historical template and design-contract validation and never silently reinterpret a version. Rendering support remains Part 3.

## Creation, immutability and reads

createDocumentSnapshot accepts only `{orderId, readingId}`. It verifies persisted owner scope, locks the Store, obtains both validated inputs, derives coherent Product identity, constructs/hashes/validates the complete value and inserts atomically. No upstream state is mutated. It returns a detached recursively frozen readonly value.

Uniqueness is owned Reading + approved review + design identity/revision + semantic hash. Identical concurrent/duplicate intent returns the existing validated snapshot. New design revisions/presentation can intentionally create a new snapshot; no one-snapshot-forever restriction. Provenance revisions may yield distinct snapshots with equal semantic hashes.

getDocumentSnapshotForRender loads exact owned persisted input and checks Zod, content/config/snapshot hashes, body and payload bounds, timestamps, template/version support, relational/payload consistency and immutable approval/Product/Reading source evidence. Source design identity/revision is checked for ownership and plausible historical revision; current design config/status, default and assignment are not consulted. Body is never read from current Review/draft/Generation state. Corrupt state fails closed without repair/substitution.

Design edits, Product reassignment, default changes and safe archival do not mutate/invalidate previous snapshots. Later/latest Generation is not queried. Snapshot creation may fail if current upstream eligibility/design is unavailable; historical reads remain independent of those mutable settings. Future preview/PDF/artifacts must consume this exact boundary.

## Three hashes and bounds

Approved contentHash retains SHA-256 of stable JSON `{sections}`. ConfigurationHash retains SHA-256 of normalized design configuration. SnapshotHash is SHA-256 of stable JSON covering order identity/reference/customer display name, Product identity/display name, Reading number/quantity, exact sections, approval timestamp, template identity/contract/version and exact design config. It excludes creation time, snapshot/tenant/Reading/review/generation provenance, design identity/revision/name/source and redundant hashes. Design name is operational metadata, not a document title. Approval time is future displayed reading date evidence.

Ordered exact text is preserved, never truncated. Upstream section bounds remain 1–20 sections, 40,000 characters each, 512,000 UTF-8 aggregate bytes. Canonical snapshot serialization is capped at 600,000 UTF-8 bytes. SQL JSONB text cap is 650,000 bytes to accommodate database whitespace serialization.

## Migration, security and concurrency

Additive `0017_yielding_peter_quill.sql` creates document_snapshots: owned Reading/Order/Product/Review/pinned Generation/design references, frozen payload, semantic hash, source design revision and timestamp. Composite foreign keys, unique intent key and owned Reading lookup index apply. No fabricated snapshots, destructive changes, backfill or upstream mutation.

SQL insert guard validates approved content/hash, exact active design config/revision, owned relationship coherence and payload/column identity/time consistency. UPDATE and DELETE are always blocked. Application validation remains authoritative for full Zod and SHA-256 validation.

Existing Store locks serialize design updates, assignment/default changes, archive and snapshot creation. One transaction produces one coherent state; no hybrid revision/config or partial snapshot. Unique constraints protect duplicate storage. Reads are repeatable-read and tenant scoped. Cross-org/sibling Store, forged intent/snapshot identifiers and forged foreign design provenance fail closed.

## Tests and validation

Sixteen new unit cases cover strict shape, frozen detachment, exact Unicode text, semantic hash inclusion/exclusion, malformed contracts/sections/order/hashes/config/template/timestamp, duplicate sections, unknown/internal/asset fields, size limits and minimal intent/historical template lookup.

Ten focused DB cases cover canonical/default and edited/product-assigned snapshots, exact content/provenance/display context, PENDING/draft-only rejection, duplicate/concurrent creation, SQL immutability, design-edit/reassignment/default/archive independence, tenant/forged intent/read boundaries, corruption, failed upstream admission with atomic rollback, coherent settings races, isolation from mutable draft/generated body and foreign design provenance despite matching forged payload/columns. All fixtures are synthetic; Generation setup uses fake providers only.

All required checks PASS: pnpm typecheck; pnpm test (183 unit tests, 28 files); pnpm test:db (293 DB tests, 13 files); pnpm build; git diff --check. Total: 476 tests across 41 files. Migration replay from scratch and repeat/no-op verification PASS in the full DB suite. Existing migration runner tests replay from scratch and repeat/no-op while preserving fixtures. Drizzle reports no schema drift. Build-generated Next.js tooling noise is inspected/restored; no intentional configuration discarded.

## Boundaries retained

Document Design Part 1 remains intact. Review lifecycle/approval and Generation behavior remain intact; only composable handoff and owned Product identity reads are added. No seller UI, page dimensions/margins/metrics, wrapping, pagination, layout tree, HTML/CSS, renderer, preview, PDF, artifact/storage/download, assets/uploads or delivery exists in Part 2. Real Gemini calls: 0. Nothing pushed or deployed.

## Files changed

- src/modules/documents/snapshot-contract.ts
- src/modules/documents/snapshot-service.ts
- src/modules/documents/contracts.ts
- src/modules/documents/service.ts
- src/modules/products/service.ts
- src/modules/review/service.ts
- src/db/schema.ts
- drizzle/0017_yielding_peter_quill.sql
- drizzle/meta/0017_snapshot.json
- drizzle/meta/_journal.json
- tests/document-snapshot.test.ts
- tests/document-snapshot.db.test.ts
- docs/DOCUMENT_ENGINE.md
- docs/DOCUMENT_ENGINE_PART2_REPORT.md
