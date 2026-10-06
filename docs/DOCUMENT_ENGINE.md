# Document Engine

Part 1 establishes presentation configuration only. **PART 1 DOES NOT CREATE DOCUMENTS OR PDFs.** Frontend implementation is intentionally deferred.

The future pipeline combines the Review-owned `approved-reading/v1` value from `getApprovedReadingForDocument(...)` with `resolved-document-design/v1`, then creates an immutable Document Snapshot, followed by deterministic layout/pagination and preview/PDF. Review owns approved body content. Document consumers must never obtain body content from latest Generation, current draft, Review persistence internals, Style Intelligence or provider output.

## Controlled design domain

`src/modules/documents` owns reusable Store-owned presentation designs, platform registries, assignment and resolution. It is independent of Review, Generation, orchestration and AI accounting. No reading content or AI/provider metadata is stored in designs.

Base templates are code-owned supported layout families: `classic`, `mystic`, `minimal`, `modern`, currently template version 1. Sellers cannot supply executable HTML/CSS, coordinates or arbitrary layouts. Template definitions describe capabilities; no rendering exists. Classic and Mystic permit the future card-imagery display preference; Minimal and Modern do not. This preference supplies no images and does not claim asset support.

`document-design/v1` is a strict Zod contract: template; plain brand name (120 characters); primary/accent colors; controlled heading/body fonts; SIMPLE or BRAND cover; explicit customer-name, reading-date, section-divider, card-imagery and footer booleans; optional-in-meaning empty footer text (500 characters). All fields are required for deterministic configuration. Unknown fields are rejected. Design name is nonblank and at most 100 characters. Text rejects angle brackets; arbitrary HTML and CSS fields are unsupported. Configuration is bounded to 8 KiB. Six-digit hex colors normalize to uppercase; CSS functions, variables, URLs and fragments are rejected.

Controlled font keys are `inter` and `source-serif-4`, usable for headings and body. Part 1 neither downloads nor bundles fonts. The renderer will map these stable keys to controlled assets. Logo references and PRODUCT_IMAGE covers are deferred: the existing private-object-storage port has no durable owned asset identity. No unsafe URL substitute is accepted.

## Persistence and lifecycle

`document_designs` stores owned identity, name, ACTIVE/ARCHIVED state, validated JSON configuration, revision, default flag and timestamps. Designs are mutable presentation settings with optimistic revision protection, not immutable history chains. Every actual update/default change/archive advances revision; identical writes at the current revision and identical default/assignment requests do not advance state. A stale design update fails with a conflict. Archival is terminal and repeat-safe. Deletion is forbidden.

This model deliberately relies on the future Document Snapshot to freeze exact resolved configuration. Updating a design will not mutate historical document snapshots once that domain exists. No snapshots exist in Part 1.

`product_document_designs` attaches the stable owned Product identity to an owned design. It does not modify ProductVersion or reading semantics. Presentation policy resolves at future document creation; the snapshot will freeze its result. Assignment replacement is deterministic, unique per Product, and may be removed. No seller design/default is fabricated and no existing data is backfilled.

At most one default exists per Store. Archiving any default or assigned design is blocked; remove assignments/default first. Foreign, malformed or unusable assigned designs fail closed rather than falling through to another design. No random fallback occurs.

## Services and immutable boundary

Services provide create, list/get, expected-revision update, archive, set/clear default, assign/unassign Product, and `resolveDocumentDesignForProduct`. Resolution first authorizes the Product, then prefers its assignment, otherwise the Store default. Missing configuration returns explicit `SETUP_REQUIRED`. Invalid durable data throws a bounded unavailable error and is never repaired during reads.

Successful resolution returns `RESOLVED` with a strict detached recursively frozen `resolved-document-design/v1`: organization/Store/Product identity, design identity/name/revision, PRODUCT or STORE_DEFAULT source, template version, exact normalized configuration and SHA-256 configuration hash. The hash uses existing stable JSON serialization. No writable persistence row, Reading body, customer facts, draft API or infrastructure state is returned. Part 2 can combine this value with approved-reading/v1 without knowing persistence implementation details.

All reads verify persisted membership and Store ownership. All writes require the existing owner scope and serialize under the Store row lock. Composite foreign keys enforce Product/design/Store compatibility. A partial unique index guarantees one default, checks bound status/config/revision, and SQL guards protect identity, revision progression, archive retention and active assignment. Assignment guards lock the design row; service locks serialize default/assignment/archive races. No distributed locks, queues or generic command framework are introduced.

## Deferred work

Document Snapshot, document creation, pagination, page breaks, preview, PDF rendering/storage/download, branding/logo upload, template/design UI and Product assignment UI are deferred. Future preview and PDF must share the deterministic layout model. Controlled customization remains the product direction, not a Canva-like editor. Delivery, billing and AI design generation are outside this domain. Real Gemini calls during Part 1: zero.
