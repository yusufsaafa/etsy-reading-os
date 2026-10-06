# Document Engine

Parts 1–2 establish presentation configuration and immutable semantic snapshots. **Neither part renders documents or creates PDFs.** Frontend implementation is intentionally deferred.

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

Document Snapshot creation is implemented in Part 2 below. Pagination, page breaks, preview, PDF rendering/storage/download, branding/logo upload, template/design UI and Product assignment UI are deferred. Future preview and PDF must share the deterministic layout model. Controlled customization remains the product direction, not a Canva-like editor. Delivery, billing and AI design generation are outside this domain. Real Gemini calls during Part 1: zero.

## Part 2 — immutable semantic snapshots

**PART 2 DOES NOT RENDER OR CREATE A PDF.** The implemented pipeline is now approved-reading/v1 + resolved-document-design/v1 → document-snapshot/v1 → future deterministic layout/rendering. Frontend remains deferred.

`createDocumentSnapshot(db, scope, {orderId, readingId})` accepts only intent. It verifies the persisted owner scope, locks the Store, consumes the existing approved-reading handoff and design resolution through transaction-composable variants, and persists in the same transaction. The approved-reading/v1 shape remains unchanged. Because that handoff intentionally exposes Product display name rather than Product identity, the Product module derives identity through the exact owned Reading/pinned Generation/ProductVersion relationship. This lookup selects identity only, never body content. No raw Etsy customer context is gathered. Neither content, design, Product ID nor provenance may be supplied by the client.

`document-snapshot/v1` freezes identity/ownership, Reading/order/Product identities, approved customer and purchased-product display names, Reading number/quantity, exact ordered section IDs/titles/bodies, approval timestamp/content hash, design identity/revision/name/resolution source, template key/contract/version, exact validated document-design/v1 config/configuration hash, source Review/Generation provenance, snapshot hash and creation time. Customer questions/answers, draft internals, provider/accounting/style data and arbitrary asset URLs are absent. Generation identity is retained as approved source provenance, not as a body retrieval instruction.

### Three independent hashes

- Approved `contentHash`: existing stable JSON + SHA-256 of `{sections}`, including exact ordered IDs/titles/bodies.
- Design `configurationHash`: existing stable JSON + SHA-256 of the normalized document-design/v1 config.
- `snapshotHash`: SHA-256 of stable JSON containing frozen order identity/reference/customer name; Product identity/display name; Reading number/quantity; exact sections; approval timestamp; template key/contract/version; exact design config. Creation time, snapshot identity, tenant/Reading/review/generation provenance, design identity/revision/name/resolution source and redundant hashes are excluded. Those fields identify/describe provenance, not layout content. Design name is operational metadata, not a document heading. Approved time is included because it supplies the future reading-date display.

Changes to ordered content, display context, template version or presentation config change semantic hash. Changing creation time or provenance alone does not. This v1 meaning must remain stable; future incompatible semantic hash rules require a new contract version.

### Durable storage and idempotency

Additive migration 0017_yielding_peter_quill creates `document_snapshots`, with owned relational references to Reading, Order, Product, approved Review/pinned Generation and source design, frozen JSONB payload, design revision, semantic hash and timestamp. No snapshots are fabricated and no upstream data is mutated.

A unique owned intent key `(organization, Store, Reading, review, design, design revision, snapshotHash)` reuses an identical creation at the exact source revision. Revision changes may intentionally create a new provenance snapshot even if semantics/hash remain equal. This permits later design edits/reassignment to create new snapshots without imposing one snapshot forever per Reading. Serialized Store-locked creation and uniqueness prevent concurrent duplicates. An existing snapshot is validated before being returned; corruption is not overwritten or repaired.

SQL guards forbid every snapshot UPDATE/DELETE and validate insertion against owned approval, exact approved sections/content hash, exact current active design configuration/revision, owned Reading/order/Product/pinned Generation relationships, payload/column identities and creation timestamp. Foreign keys and bounds supplement authoritative application validation. SQL does not implement Zod or hashes; reads validate those again. Payload storage has a 650,000-byte JSONB text guard, allowing PostgreSQL serialization overhead; canonical application JSON is limited to 600,000 UTF-8 bytes, with approved sections independently retaining the existing 512,000-byte aggregate limit. Per-section limits remain 40,000 characters and 1–20 sections. Content is never truncated.

### Rendering read boundary and historical independence

`getDocumentSnapshotForRender` authorizes Store ownership, loads one exact snapshot, validates strict contract, three hashes, timestamps, size, retained template version, denormalized identity consistency and immutable source relationships. It returns a detached deeply readonly/frozen value. It selects approval/identity evidence and owned source-design identity/revision (never configuration), verifying the historical revision cannot exceed the monotonically advancing source revision: it never re-reads approved body, generated body, mutable draft, current design config/default/assignment or latest Generation. No current operational eligibility check or active-design requirement is imposed on historical reads.

Updating the source design, changing Product assignment/default or safely archiving the released source design never changes or invalidates an existing snapshot. New creation must pass the current upstream admission/resolution boundaries; historical rendering uses the frozen snapshot. The source identity rows remain protected by foreign keys/retention rules. Corruption fails closed with DOCUMENT_SNAPSHOT_UNAVAILABLE; no silent substitution/current-state repair occurs.

All settings and snapshot creation use existing Store locks, producing one coherent state when creation races design update/reassignment/default/archive. Production PostgreSQL read-committed transaction semantics let a waiting creation read the committed state after acquiring the lock. There is no automatic retry framework. A released/absent design produces an explicit setup-required failure with no partial snapshot.

### Template evolution

Code-owned `DOCUMENT_TEMPLATE_VERSIONS` retains immutable historical definitions separately from current `DOCUMENT_TEMPLATES` selection. Snapshot validity looks up exact key/version, not a floating default. Adding templates or versions needs no SQL enum/schema redesign; application registries/contracts evolve explicitly. Keep document-design/v1 validation and historical definitions available for old snapshots. Any rendering-semantic template change requires a new version; do not overwrite/reinterpret an old version. Unknown key/version fails closed. Part 3 must implement support for the retained exact versions rather than silently substituting a current template.

### Snapshot versus artifact

A snapshot is immutable semantic input. A future artifact is preview/PDF output derived from one exact snapshot. One snapshot may support preview, PDF and re-rendering without mutable-state resolution. Page dimensions, margins, typography metrics, layout trees, pagination, HTML/CSS, preview, rendering, binaries, storage and downloads remain unimplemented. No asset system, seller UI or provider operation is introduced. Real Gemini calls in Part 2: zero.
