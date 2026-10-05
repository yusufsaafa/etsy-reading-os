# Seller identity and style library

Reading OS is operational ecommerce software, not an AI product UI. Reading sellers are the first market; identity, structured style and previous work are generic personalized-product concepts.

## Single-seller V1

Exactly one SellerProfile and one StyleProfile may belong to a Store. Store is the Etsy shop/business; SellerProfile is the person or business voice producing the work. “Sarah’s Intuitive Tarot” and “Sarah” are different identities. There are no reader lists, assignments, product-to-reader mappings or reader queues.

`modules/seller-style` owns four relational tables:

| Table | Responsibility |
| --- | --- |
| seller_profiles | One store-owned identity: display name, optional short bio, creation/update time |
| style_profiles | One stable store-owned style identity and exact active-version pointer |
| style_profile_versions | Version number, draft revision, lifecycle, publication time and structured configuration |
| style_sources | Optional immutable pasted-text reference, title, SHA-256 content digest, command key and creation time |

Four tables separate mutable identity, stable style ownership, published instructions and independently managed reference material. Individual style dimensions are bounded JSONB value objects; they need no tables or taxonomy framework.

A future proven multi-creator requirement would require an explicit creator ownership migration and revised uniqueness/authorization. Stable IDs and scoped references permit that migration; no speculative multi-reader machinery is built now.

## Profile and structured style

A profile needs only a nonempty display name (maximum 100 characters). Short bio is optional (maximum 1,000). No photo, social profile, document or previous work is required. Metadata saves reuse the single profile and exact save replay produces no extra audit.

Style configuration contains:

- Tone: Warm, Direct, Reassuring, Neutral or Custom.
- Detail: Concise, Balanced or Detailed.
- Writing approach: Conversational, Structured, Reflective or Custom.
- Preferred expressions and expressions to avoid: at most 30 entries each, 300 characters per entry.
- Additional guidance: at most 4,000 characters; required when either Custom choice is selected.

These are descriptive data, not provider prompts. Drafts can leave the three required choices empty. Applying style requires a saved seller name and all required choices. Previous work and bio are optional. No category-specific fields or provider settings exist.

## Lifecycle and concurrency

Reads never initialize records. “Set up your style” creates one stable style profile and one draft through an authorized command. “Edit style” clones the active configuration into the next draft; replay returns the existing draft.

Draft saves require an expected revision. Exact same-payload replay is a no-op, including after a lost first response. A different stale payload fails. “Save changes” preserves the current published style. “Apply style” validates server-side, archives the old version, publishes the draft and updates the pointer in one transaction under the Store row lock. Exact activation replay returns the existing publication without extra versions or audit records.

Composite ownership foreign keys, unique version numbers, one-active/one-draft partial unique indexes, published-version immutability and deferred pointer-consistency triggers protect the invariants. Published configurations and historical versions cannot be edited/deleted. Draft identity/ownership/version number cannot move. The handwritten triggers in `0004_tense_hammerhead.sql` must be retained in later migrations.

## Previous work

Paste a title and up to 50,000 characters of text. Unicode and line breaks are preserved. React escapes content; markup stays text. A server-derived Store scope owns the record, and a store-scoped command key plus digest/title comparison prevents duplicate creation or different-payload command reuse.

The library lists metadata. Opening a reference uses a separately protected, scoped server read; library rows do not preload every document body. Sources cannot be edited in place. Removing a source permanently removes its text record, with a metadata-only audit; repeated removal is a scoped no-op. Cross-tenant removal cannot affect another store. Command keys are per creation attempt and must not be reused after deletion.

Add only work the seller is authorized to share, with customer details removed. Sources are untrusted reference data, never authoritative instructions for permissions or tools. No extraction, summarization, embeddings or analysis occurs.

## File uploads and object storage

Inspection found only the existing `PrivateObjectStorage` port; there is no private storage adapter or upload/download infrastructure. Therefore this milestone does **not** accept any files, create object keys, store binaries in PostgreSQL, expose public URLs or invent successful uploads. The UI truthfully offers pasted text and explains that file uploads are unavailable. No profile-image control or fake file picker is shown.

A future file slice must implement that same provider-neutral port with private tenant-scoped access, server-generated keys, server-side MIME/signature and size validation, authorized reads/removal, bounded resource handling and a retention/deletion policy. PDF parsing/rendering technology is undecided. Deeper scanning and extraction require explicit review; no dependency stack or cloud adapter was added here.

## Authorization and audit

Every domain read verifies membership; every mutation requires owner access and verifies the supplied Scope against persisted Store membership. Server actions derive the current scope from Auth.js/server data, never organization/store form fields. Every table query is scoped by both organization and store; cross-tenant version/pointer/Store relationships also fail database constraints. Existing Next.js action-origin, Auth.js, OAuth state, token encryption and disconnect fencing are unchanged.

Audit actions: seller_profile_created/updated, style_draft_created/saved, style_applied, style_source_created/deleted. Records contain actor, Store, action and resource identity only. Names, bio, instructions, source titles/text and credentials are excluded. Application error responses are bounded, seller-facing messages; raw database errors are not returned.

## Future production read contract

`sellerProductionContext(db, scope, optionalStyleVersionId)` is a server/domain boundary. It reads a repeatable-read snapshot and returns either missing profile/style information or:

- Seller identity data and its update time.
- Exact published style version ID and structured configuration.
- Available source metadata, identities and content digests.

An explicit historical published version is available only within the authorized Store; drafts are rejected. `previousWorkContent` is the separate scoped content read for deliberately selected references. This boundary makes no network calls and performs no generation.

The future generation layer must bind its exact StyleProfileVersion and ProductVersion, retain a snapshot/hash of mutable seller identity and Customer Context, and freeze the chosen source IDs/digests/content according to approved retention policy. Historical style lookup does not reconstruct yesterday’s mutable seller metadata or deleted sources. Add appropriate source-reference/deletion guarantees before generation exists; current deletion is safe because no production records reference sources yet. Platform rules and customer text remain separate. Sources never override tenant authority, budgets or tool policy.

ProductVersion remains what the product requires/contains; SellerProfile is who; StyleProfileVersion is how; Customer Context is this purchase. There is no merged prompt configuration or Generation table.

## Onboarding compatibility

Existing persisted completion remains unchanged: one selected, active, unpaused configured Product permits explicit Continue to Home. New and existing completed stores retain operational access. No store is reset, no identity/style is fabricated, and orders gain no new blocking states.

Profile/style setup is available through Settings → Your profile & style after product setup. The context boundary reports minimal completeness independently, so future production can fail closed when profile/style is absent, without pretending generation exists today.

Before production onboarding requires “Configure product → Profile → Style → Store ready,” add an explicit onboarding-flow revision/new-store policy, preserve already-completed stores’ operational access, offer missing setup contextually, and require usable identity/style at the generation admission boundary. Existing completion alone must never authorize automated production. This explicit transition avoids ambiguously reinterpreting already-completed development stores.

## Non-goals

No multi-reader support, assignments, seller style analysis, AI/provider SDK or requests, embeddings, vector database, prompt building, generation, PDF rendering, delivery, queue/scheduler, urgency engine, Telegram, billing, subscriptions or analytics redesign. No new dependencies. Live Etsy and production-auth gates remain as documented separately.
