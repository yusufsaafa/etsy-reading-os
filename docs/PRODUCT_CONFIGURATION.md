# Product configuration

Reading sellers are the first market; the core supports generic personalized digital products. No date of birth, tarot question, card, spread or partner attribute is a domain column. Sellers define those as ordinary inputs and content sections when needed.

## Storage and boundaries

`modules/products` owns draft creation, edits, activation and the runtime configuration lookup. It evolves the existing `listing_mappings` table rather than introducing another mapping or validation system. Two relational tables are sufficient for this slice:

- `products`: stable seller-owned identity, display name, status and active-version pointer. Exactly one authorized store owns it.
- `product_versions`: product ownership, monotonically increasing version number, DRAFT / ACTIVE / ARCHIVED, draft revision, timestamps and typed JSONB configuration.

Input definitions and content sections are bounded, ordered value objects inside a version. They do not need independent mutation or cross-product sharing in this milestone; separate tables would add joins without an immediate domain benefit. Output and workflow are also version-owned values. Future type additions extend configuration validation without adding fixed product columns.

All new tables and references use composite organization/store foreign keys. Owner authorization and a store-row lock precede mutations. Catalog reads require membership and are tenant-scoped. Browser identifiers are resource selectors, never trusted authorization scopes.

## Version lifecycle

A selected active Etsy listing starts a DRAFT v1 through a POST command. Creating it again returns the same product/mapping. Incomplete drafts may have an empty name, no inputs/sections and no output. Structurally invalid values still fail Zod validation.

Editing an ACTIVE product clones its immutable configuration into one DRAFT v2. Draft saves require an expected revision; replay of the exact same payload is a no-op. A different stale payload fails instead of overwriting another edit.

Activation validates on the server, then archives the prior version, activates the draft and updates the product pointer in one transaction under the same store lock used by intake. Activation replay returns the already activated version without extra mappings, versions or audit events. Draft edits never change the active version's production instructions. The stable product display name may change independently; historical order titles remain purchase snapshots.

Database partial unique indexes permit at most one ACTIVE and one DRAFT per product. Triggers protect published configuration/identity from mutation or deletion, require version creation as a draft, enforce important publish structure, and verify the active pointer at transaction commit. These handwritten trigger additions are part of migration `0003_dapper_sir_ram.sql`; retain them in future schema work even though Drizzle's schema snapshots do not express triggers.

## Customer information

Each InputDefinition has an ID, unique key, seller label, TEXT / LONG_TEXT / DATE type, required flag, help text and sort order. There is no semantic parser. The existing deterministic intake validator accepts an exact NFC-normalized field label or configured key. Free-text personalization with no matching label remains unresolved. Multiple answers matching one field are ambiguous and held. DATE requires a real ISO calendar date (`YYYY-MM-DD`). Optional absent fields do not block readiness; supplied malformed optional answers still require review.

The seller correction form includes missing configured fields from the reading's retained version. Corrections append CustomerInput revisions with provenance; purchase snapshots remain unchanged. Quantity >1 still needs explicit per-reading allocation, even when required answers are present. Payment, cancellation, refund, digital-item, source-change and pause holds continue to apply. Ready is the existing issue projection, not a new independent status table.

## Content, output and workflow

Content sections have stable IDs, seller-defined titles, short instructions and consecutive sort order. They are configuration data, not model prompts. Publishing requires at least one named section. Arrays are deterministically ordered when saved.

Output supports TEXT and PDF **preferences only**. No document is created and no renderer is selected. Workflow defaults to ASSISTED. In production orchestration Part 1, MANUAL remains seller-started and ASSISTED automatically admits eligible readings to durable waiting work. It does not mean automatic delivery. Optional version-owned fulfillment priority and target minutes support future planning; absent values resolve to Standard/no target. AUTOMATIC is recognized structurally but disabled in the UI and rejected at activation until safe execution exists. Queue execution remains deferred; existing manual canonical preparation remains available. See PRODUCTION_ORCHESTRATION.md.

## Etsy bindings

An existing mapping now optionally references a Product. Matching remains exact on store + external listing ID + variant key. There is no SKU fallback and no default fallback for an unknown variant. One listing can therefore have separate products/configurations for standard and purchased variant options. This UI can configure variants observed on existing order lines; importing the complete live inventory/variation catalog remains outside the currently verified Etsy adapter contract.

Pausing a mapping remains an operational hold, separate from version status. Legacy mappings retain their original required-input checks and pause behavior. They are displayed as Setup required until a real versioned configuration exists; no fixture or old mapping is silently promoted to a configured product.

## Historical safety

New fulfillment units resolve an ACTIVE version inside the intake transaction and retain its immutable, tenant-owned `product_version_id`. Database guards forbid changing that binding. Archived versions remain readable for historical readiness and future production. Existing readings are evaluated against their bound version on replay and seller correction, never today's active configuration.

Migration labels existing units `legacy` and keeps their prior checks. New unresolved units are explicitly `unconfigured`; publishing later does **not** retroactively adopt a version on replay. They remain held for a future explicit, audited configuration assignment workflow, which is deliberately not invented here. Unconfigured/legacy rows cannot masquerade as version-bound production.

## Activation invariants

- Authorized owner, owned store/product/version and an existing valid mapping to an active Etsy listing.
- Nonempty valid product name; structurally valid bounded definitions.
- Distinct input keys and labels, stable distinct IDs, consecutive deterministic ordering.
- At least one named content section, explicit output and workflow, currently supported workflow.
- At most one active version; consistent active pointer; transaction rollback on any failure.
- Immutable published versions and historical fulfillment bindings.

## Onboarding

Selection is intent, not configuration. Product Setup now replaces the earlier placeholder. At least one selected listing mapped to an ACTIVE configured product and not paused allows the explicit Continue to Home command to persist `onboarding_stage=complete`. Other selected products remain Setup required and can be finished from Products. Completion replay creates no extra audit record. Existing completed Milestone 1 stores retain operations access.

## Non-goals and remaining work

No AI SDK/calls, prompts, seller style/profile analysis, PDF rendering, delivery, billing or new infrastructure. No semantic personalization extraction, conditional form builder, arbitrary mapping rules, configuration sharing, archived-version deletion, or historical assignment UI. Live Etsy intake remains gated by the existing unverified response contract. Product screens reuse the locked Reading OS shell and primitives; Landing, Auth and Home are unchanged.


## Reading Media — Part 2.5B

ProductVersion configuration now supports optional bounded readingMedia NONE/TAROT_CARDS (1–10 cards). Historical absence is interpreted as NONE without changing stored JSON; exact requirements freeze with GenerationContext. No deck belongs to Product config and no media UI is added. See READING_MEDIA.md.


## Etsy source mapping — real acceptance Part 4

Optional version-owned etsyFulfillment now explicitly approves READING eligibility for an exact Etsy listing/property/value combination and question-ID-to-input-key mapping. Physical and digital marketplace classifications are preserved independently of fulfillment eligibility. Canonical source bindings reuse listing_mappings uniqueness; immutable ProductVersion approval and historical unit pins remain authoritative. No label/position/SKU guess or global tier/delivery dictionary is used. Earlier purchases without retained versions are held, not rebound to today's configuration. The legacy not_digital path remains unchanged for old contracts. See [source contract and limits](ETSY_SOURCE_CONTRACT.md). This supersedes the original digital-item-only assumption for explicitly configured source-bearing purchases; no real intake/UI/sync is enabled.

Reading OS must adapt to existing seller Etsy listings through explicit mapping whenever the Etsy contract provides sufficient stable source identity; sellers must not be required to rename, reorder, recreate or reclassify listings merely to conform to Reading OS terminology.

## Etsy historical permission — real acceptance Part 5

Receipt-scoped owner-authorized `etsy-historical-adoption/v1` decisions now permit later initial resolution of selected pre-activation purchases against an exact published owned ProductVersion. Default stays from activation forward. Immutable Store-owned decision provenance includes original receipt/listing/full-option identity scope, inclusive approved purchase-time bounds and owner command/time. Bounds alone do not import orders; no Product UI or bulk historical adoption exists. Archived pins survive later activation; payment/status/refund/question/unsupported/context checks remain independent. Existing immutable unit bindings, including unresolved pins, are not rewritten. See ETSY_SOURCE_CONTRACT.md Part5.

## MVP setup target policy and coverage — 2026-10-08

Source-aware activation approves one exact listing/property/value combination. Listing-wide coverage is a read projection of those owned bindings and valid active pointers, not new persisted status. Unconfigured combinations do not fall back to another configuration. The seller-facing setup command derives existing EXPRESS priority for targets up to 60 minutes and STANDARD for longer/absent targets; the runtime production policy continues to read the approved immutable version. Legacy active versions retain their original stored priority. No priority dropdown, delayed processing or automatic sending is introduced. MANUAL/ASSISTED behavior is unchanged. helpText remains retained setup-note metadata, not a parsing rule or provider instruction. See ONBOARDING_REPORT.md for exact local MRH evidence and unverified browser checks.
