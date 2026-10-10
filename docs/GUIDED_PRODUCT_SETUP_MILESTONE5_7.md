# Guided Product Setup — Milestone 5.7

## Architecture audit (before implementation)

- Product identity and versioned configuration remain separate from Etsy Listing and exact `etsy-selection/1` mappings.
- `configurationSchema` is the strict authoritative configuration boundary; `orderedConfiguration` normalizes ordering. `configurationIssues`, `setupReadiness`, and `configurationBindingErrors` remain publication/setup authorities.
- `saveProductDraft` performs revision-controlled DRAFT-only updates; `editProduct` creates the existing single editable draft under the Store lock; `activateProduct` remains a separate explicit publication command. No reuse publication command is introduced.
- ProductEditor is one mounted editor shared between Product Setup and Generation Settings, with beforeunload/link navigation protection. Reuse does not introduce another editor.
- `readProductConfigurationAssessment` supplies a bounded saved snapshot and calls the existing `product-readiness/v1` engine. PDF resolution uses the existing resolver, which does not fall back from an invalid explicit override.
- Authorization uses persisted membership and server-resolved Store scope. Mutation commands verify the owner and lock the Store before updating any ProductVersion.

## Implemented contract

`product-configuration-reuse/v1` previews source Product/version, destination saved draft identity/revision, proposed values, compatibility, field changes and a SHA-256 persisted-snapshot fence. Preview is read-only. The browser never supplies proposed configuration to Apply.

Source search starts only when opening the copy dialog or explicitly searching/paging. Name search uses escaped SQL ILIKE, stable name/ID ordering, 20 Products plus one hasMore sentinel; current ACTIVE/DRAFT versions are fetched in one batch capped at 40. No catalog/history scan, N+1 versions, external calls or writes occur. Both versions require explicit selection; ACTIVE must match the active pointer. ARCHIVED/unavailable versions and structurally invalid picker versions are excluded. Direct selection of invalid configuration fails validation.

### Reusable allowlist

- Inputs: id, key, label, type, required, helpText, sortOrder.
- Sections: id, title, instruction, sortOrder.
- Output and workflow.
- Optional fulfillment priorityClass and targetCompletionMinutes.

Nested reusable objects are explicitly constructed, not unrestricted source spreads. Strict source validation rejects unknown future fields. The destination retains its Product identity/name, metadata, exact Etsy policy (including question mappings), reading media and PDF assignment/inheritance. No source listing, choice, mapping, media/style identity, audit/publication metadata, artifact or historical snapshot is copied.

## Review and apply

Preview distinguishes WILL CHANGE, WILL STAY THE SAME and NEEDS REVIEW. Detailed field labels/types/requiredness/notes and section instructions are available in the established accessible dialog. Compatibility is STRUCTURALLY_VALID, REQUIRES_DESTINATION_CORRECTION or INCOMPATIBLE. Structurally valid incomplete drafts may be applied; publication validation remains separate. AUTOMATIC and evidence-bound overflow are incompatible. Destination question mappings that reference replaced fields require correction in the existing editor. No source question mapping is imported and no automatic repair occurs.

Existing destination saved draft impact is explicit. Unsaved browser edits are labelled separately from persisted preview and require an additional acknowledgement before replacement. A separate review confirmation gates Apply to Draft. Neither opening nor previewing creates a Product/draft.

Apply reauthorizes the owner, locks the Store and rereads source version, destination ACTIVE/DRAFT, mapping/catalog evidence and destination PDF resolution. A changed snapshot hash fails with a stale-preview explanation. Apply then calls existing editProduct (only when no draft) and saveProductDraft in the same transaction. No ACTIVE mutation, automatic publication, reassociation, PDF assignment or history rebinding occurs. Repeated Apply with an old token fails safely after the first revision change. The existing save API retains its established idempotent-save semantics.

PDF resolution is explicitly requested for reuse preview even if the destination currently uses TEXT, so a proposed PDF output is assessed against its own real assignment. The renderer/storage are never invoked. Saved readiness is not claimed until the refreshed persisted workspace is assessed.

After success, the workspace refreshes saved props, remounts the single editor on draft ID/revision and blocks editing while the expected saved version is loading. This removes stale local state; the original navigation guards remain. Check Readiness is the next action.

## Guidance

Light helper text and established InformationPopover dialogs explain internal naming, labels/types, required versus optional inputs, section titles and optional instructions. Love, career and general examples are reference text only. Preparation explains MANUAL/ASSISTED and unsupported AUTOMATIC, TEXT/PDF, optional targets and separate delivery. PDF guidance explains inheritance, explicit overrides and TEXT applicability. Readiness explains ACTIVE/DRAFT, exact associations, unknown evidence and runtime limitations. No example automatically populates fields; no new mandatory configuration rules are added.

## Security and isolation

Every service verifies persisted scope and owned resource lookups. Source Store IDs are never accepted. Preview can inspect owned saved data for members; only owner-visible UI offers Apply, and the server independently enforces owner mutation. Identical display labels never replace exact identities. Existing mapping, PDF and immutable version/artifact defenses remain authoritative. No schema/environment changes, live Etsy requests, AI dispatch, production migrations or development DB mutations are part of this milestone.

## Validation and browser acceptance

IMPLEMENTED: contextual guidance, bounded source search, explicit version selection, read-only preview, confirmed draft-only apply and refreshed editor state. Read-only members have an accessible reference dialog outside disabled editing controls. Existing publication and PDF assignment remain separate.

TESTED:

| Repository command | Result |
| --- | --- |
| `pnpm test` | 985 tests passed, 95 files |
| `pnpm test:db` | 543 tests passed, 28 files; isolated PGlite databases, repository migrations applied only to those test instances |
| `pnpm typecheck` | Passed, including after restoring verified Next-generated tooling noise |
| `NEXT_TELEMETRY_DISABLED=1 pnpm build` | Passed |
| `git diff --check` | Passed |

The new focused database suite has 10 scenarios covering ACTIVE/DRAFT choice, existing/new draft, explicit confirmation, no preview writes, stale source/destination/catalog fences, tenant/read-only rejection, preserved exact policy/mapping/PDF/history, incompatible fields, destination question correction, invalid explicit PDF override and bounded constant-query pagination. Unit coverage includes strict allowlist, guidance, read-only guidance access, confirmation/navigation guards and editor refresh contracts. Existing Orders, Products, catalog, generation and PDF regression suites remain included. Lint is not configured.

Browser acceptance used actual ApplicationFrame, ProductWorkspace, ProductEditor, PDF Appearance, Readiness and InformationPopover components in an isolated local fixture harness. Saved source/configuration previews were generated through the actual merge and readiness functions; browser server actions and refresh were simulated with in-memory fixtures. No development database or real Store was changed. This proves fixture UI behavior, not authenticated end-to-end server action integration.

Desktop 1440px, tablet 768px and mobile 390px were inspected. Empty/populated setup, source picker, explicit ACTIVE/DRAFT selection, compatibility warning, existing draft impact, unsaved-change acknowledgement, successful apply, readiness handoff and read-only states were captured. Pages and open dialogs had no observed horizontal overflow. Mobile dialog width was 358px at a 390px viewport, with internal scrolling for long content. Nested review-dialog Escape preserves the parent dialog and returns focus to its trigger; closing the parent returns focus to Copy Configuration. Read-only guidance opens and closes with correct focus while edit/copy controls remain unavailable. Source selection never chooses a version automatically. Confirmed fixture apply refreshes visible field/section values and retains destination identity.

Screenshots are in [acceptance/milestone5_7](acceptance/milestone5_7), including [desktop preview](acceptance/milestone5_7/copy-preview-warning-desktop.jpg), [tablet preview](acceptance/milestone5_7/copy-preview-warning-tablet.jpg), [mobile apply](acceptance/milestone5_7/copy-success-mobile.jpg) and [read-only mobile guidance](acceptance/milestone5_7/read-only-guidance-mobile.jpg). Final mobile measurements are recorded in [mobile-final-measurements.json](acceptance/milestone5_7/mobile-final-measurements.json).

NOT VERIFIED: authenticated real-store browser acceptance, external runtime availability and Figma comparison. Figma was not accessed. No live Etsy calls, AI dispatch, PDF rendering/storage writes, automatic publication or automatic association were performed. An applied draft can still need destination correction and publication; success does not imply READY.

Known limits: source search uses bounded offset pagination, not a Store-wide preload; invalid picker versions can leave a sparse page. Destinations exceeding the existing association bound cannot apply because complete compatibility evidence is unavailable. A failed workspace refresh leaves editing blocked until saved props match the applied revision; reloading retrieves the persisted draft. No automatic recovery or background external calls are introduced.
