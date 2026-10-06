# Document / PDF Engine — Part 1 report

Starting commit: `a22f706f5d1e669a4bdc1be0feebe3652d595b12`, branch `codex/ui-ux-design-lock`. Ending commit is reported in the task response; a commit cannot contain its own SHA.

## Delivered domain

Dedicated `src/modules/documents/contracts.ts` and `service.ts` provide the Document Design foundation only. Code-owned Classic, Mystic, Minimal and Modern templates use stable keys and document-template/v1 metadata, version 1. Controlled font keys are Inter and Source Serif 4. No font assets are downloaded or rendered.

Strict document-design/v1 supports brand name, normalized six-digit uppercase primary/accent hex colors, controlled heading/body fonts, SIMPLE/BRAND cover, five explicit display booleans and bounded footer text. Design name: 100 characters; brand: 120; footer: 500; config: 8 KiB. Unknown fields, arbitrary HTML/CSS/URLs, unsupported fonts/templates and unsupported imagery preferences fail validation. Logo/product-image references are deferred because no safe durable asset ownership model exists.

Designs are reusable owned mutable configuration rows with revision protection. Update checks expected revision; actual edits, default changes and archival increment revision. Archive is terminal; defaults and assigned designs must first be released. Deletion is blocked. No design history subsystem is introduced: future Document Snapshot freezes the exact current resolved configuration.

Dedicated Product assignment uses stable owned Product identity, independent of ProductVersion configuration. One assignment per Product; replacement/unassignment is deterministic and duplicate-safe. Product assignment takes precedence over the single Store default. Missing design returns SETUP_REQUIRED. Corrupt/unusable assigned state fails closed without fallback. No defaults/designs are fabricated.

Resolved-document-design/v1 is detached, recursively frozen, strictly validated and contains ownership, Product/design identity, revision/name, source, template version, exact config and stable-JSON SHA-256 configuration hash. It contains no Reading content or AI/provider metadata. Part 2 can combine it with approved-reading/v1 without understanding persistence.

## Database, security and concurrency

Additive migration `0016_unknown_banshee.sql` creates document_designs and product_document_designs, composite ownership foreign keys, assignment uniqueness, a partial single-default index, reference index and basic state/bounds checks. SQL guards retain identity, require revision progression, prevent deleting/altering archived designs, block archive while in use and require active assigned designs. No historical mutation/backfill occurs.

Every service lookup verifies membership and persisted Store/Product/design predicates. Writes use the existing owner authorization and Store row lock. Default changes and assignment/archive operations serialize transactionally; no distributed infrastructure or generic idempotency framework. Resolution reads in repeatable-read isolation and validates before returning content. Settings reads avoid per-row queries. No frontend files are changed.

## Coverage and validation

Four focused unit tests cover template/font capabilities, strict unknown/injection rejection, normalized colors/text bounds, detached deeply frozen resolution and deterministic hash validation. Six grouped DB tests cover owned create/update/conflict, assignment/default precedence and clearing, archive retention/SQL guards, cross-organization/sibling-store/forged ownership, concurrent default/assignment/archive safety, and corrupt durable configuration rejection. Existing Review, Generation, production and Style Intelligence regressions remain active. Existing migration runner tests replay all migrations from scratch and verify repeat application preserves data.

All required checks PASS: typecheck, 167 unit tests across 27 files, 283 DB tests across 12 files, production build and diff check. Total: 450 tests across 39 files. Migration replay from scratch and repeat/no-op verification passed in the DB suite. Drizzle generation confirms no schema drift. Known build-generated Next.js configuration noise was inspected and restored, then typecheck rerun.

## Preserved boundaries

Review Workspace, ProductVersions, Generation, provider/gateway/pricing and Style Intelligence behavior remain unchanged. Document Design stores no Reading body, customer question, prompts or AI results. Real Gemini calls: 0. No frontend feature, document snapshot, pagination, preview, PDF renderer/artifact/storage/download, upload, delivery or billing is implemented. Nothing is pushed or deployed. Part 2 owns immutable Document Snapshot creation from approved-reading/v1 plus resolved-document-design/v1.

Changed files: the two Document module files; src/db/schema.ts; migration SQL, journal and snapshot; tests/document-designs.test.ts; tests/document-designs.db.test.ts; docs/DOCUMENT_ENGINE.md; this report.
