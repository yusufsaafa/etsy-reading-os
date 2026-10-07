# Etsy purchased source and approved mapping — Part 4

Implemented 2026-10-07 from d73d7a4e04a4d87fc618805463443d193a18e00e. This is an internal domain boundary, not a raw Etsy HTTP normalizer, live adapter or real-intake acceptance. Contract authority and unresolved encodings remain the Part 3 matrix in ETSY_REAL_ACCEPTANCE_REPORT.md. No fresh contract assumptions were imported from old MRH code.

Reading OS must adapt to existing seller Etsy listings through explicit mapping whenever the Etsy contract provides sufficient stable source identity; sellers must not be required to rename, reorder, recreate or reclassify listings merely to conform to Reading OS terminology.

## Purchased evidence

`modules/etsy/source-contract.ts` owns strict `etsy-purchased-line/v1`. All nested objects reject unknown fields. Optional source fields use tagged `presence: absent | null | value`, preserving differences instead of inventing defaults. IDs remain bounded opaque numeric strings; source timestamps/money are safe integers. This contract is not lossless arbitrary raw JSON: verified relevant evidence is retained, while unsupported structures must be rejected or represented by a bounded explicit unsupported condition. The future raw adapter must enumerate unsupported fields/types before this boundary, not omit them. That adapter is not implemented here.

| Boundary | Retained evidence |
| --- | --- |
| Receipt | Shop/receipt identity, observation time, creation/update timestamp presence, exact isPaid/status evidence, cancellation state/basis, bounded refund money/status/time and reason presence, separate conservative refund assessment. Refund reason content is intentionally excluded. No buyer identity/address/email. |
| Transaction | Transaction/receipt/listing identity and presence, quantity, optional/null SKU, exact isDigital, listingType and explicit PURCHASE_PINNED/CURRENT_LISTING_OBSERVATION/UNAVAILABLE provenance. A current listing classification is not relabeled as purchase-time evidence. |
| Purchase selections | Property identity, value-ID array presence, formatted name/value evidence, source position and multiplicity. Identity is the property/value set, not position/name/SKU. |
| Buyer content | Original question/property/value identity presence, source type if available, TEXT/UNRESOLVED_DROPDOWN/UNKNOWN encoding, independent answer value presence, display name and optional bounded definition evidence. UNKNOWN retains valuePresence only, without a raw value. |
| Buyer files | Explicit UNRESOLVED state, question/property/type/MIME metadata, source position, answer presence, optional observed file count and definition provenance. There is no URL or download capability. No invented file ID, label association or verified file grouping. |
| Unsupported | Fixed condition codes, optional source position/type and bounded field names. No arbitrary values/raw object. Any condition holds. Unknown input discriminator, source identifiers and value presence are retained; unknown raw values are deliberately excluded because they might be future upload URLs. The contract rejects them rather than stripping them. |

Envelope limit is128KiB UTF-8 serialized; collections cap at3 purchase dimensions,5 content questions,10 unresolved file observations,30 unsupported conditions,100 refund observations. Values/text/instructions cap at10,000 characters; display evidence at500. Source positions are0–127 and distinct across represented entries; they are evidence, never identity. Definition options cap at30, with nullable/absent option identity. These are implementation limits, not additional universal Etsy guarantees. Excess/unknown evidence must lead to a controlled hold/rejection; no truncation or silent omission. The future adapter still needs bounded response parsing before constructing the envelope.

The optional `etsySource` field in the existing canonical line contract is strictly validated. Receipt/transaction/listing/quantity/isDigital and canonical selection-key projections must agree. Raw receipt linkage is checked. Existing owned order/line snapshots retain the typed envelope without new columns or a JSON dumping ground. The intake transaction additionally verifies source shop identity against the owned Store before writes. Only isolated synthetic DB tests exercise that path in this milestone.

## Owner-approved Product policy

ProductVersion gains optional strict `etsyFulfillment: etsy-product-policy/v1`:

- Explicit `fulfillment: READING`, exact listing ID and complete purchase property/value identity set.
- Exact original question ID + property54 + approved text_input semantics → seller InputDefinition key.
- No global tier/speed synonyms, semantic label parsing, SKU fallback, option index, regex rules or model call.

InputDefinition remains the generic seller-domain TEXT/LONG_TEXT/DATE abstraction. Current mapping only supports verified purchased text encoding; dropdown option-to-value encoding and files are intentionally unresolved. Generic non-null selected-value evidence cannot be admitted as text. Future supported types require an explicit contract revision and qualifying evidence; do not fabricate a selected option/file shape.

`beginEtsyProductDraft` is a backend owner command under the existing Store lock, creating/reusing a Product and listing_mappings row with canonical `etsy-selection/1:` key derived solely from the full set of property/value IDs. Rows sort IDs only to produce a deterministic key, without assigning meaning. Duplicate properties or value IDs are rejected. Existing composite uniqueness on organization/store/listing/variant prevents duplicate bindings; the key includes all approved dimensions, so uncovered combinations have no default fallback. No UI/HTTP setup route is added. Future setup must obtain verified inventory identities and deliberate seller approval; this backend command is not an inventory validator or an automatic suggestion service.

Draft creation alone is not approval/runtime authority. Existing save/activation commands require owner authorization, expected revision and Store-first locking. Activation validates input keys and exact canonical listing binding before publishing. A canonical binding cannot change listing/selection identity or remove its source policy on edit; a new selection combination requires its own explicit binding. Published policy lives inside existing immutable ProductVersion JSONB; SQL published-version triggers protect it against mutation/deletion. Operational pause remains independent. No duplicate mapping table or competing version machine is introduced.

The selected ProductVersion carries all configured behavior: sections/output, MANUAL/ASSISTED, generic STANDARD/EXPRESS/target minutes and source question mapping. Sellers can map any verified identity combination to their own configuration. “Extra” does not mean a global tier; “Hour Same” does not mean EXPRESS until the seller approves the corresponding Product configuration. Future deterministic synonym suggestions may assist setup but must produce drafts for approval; ingestion must never consult a suggestion/model or nearest label.

## Runtime eligibility and history

`assessEtsySource` deterministically evaluates already structured source evidence and an approved policy, projecting individually mapped text answers to configured keys while retaining original evidence separately. It does not parse live JSON or call Etsy. `resolveEtsySourceConfiguration` authorizes Store membership/shop identity, finds the exact canonical owned binding and ACTIVE ProductVersion, validates the configuration, and evaluates inputs. It returns owned version/evidence/projected answers/issues, not a delivery or generation command. New persistence calls it inside the existing Store-locked intake transaction. Returned pure policy data alone is not authorization; server-owned version lookup/activation is required.

Etsy marketplace classification is not Reading OS fulfillment eligibility. Both physical-classified and digital-classified source lines can be eligible through the same explicit Product policy. `isDigital=false` and `listingType=physical` stay unchanged. Unmapped physical AND digital purchases hold. Existing fixture/legacy paths without source policy retain their original not_digital behavior; absence never grants new eligibility. A source policy without required source evidence holds.

Source payment, status, cancellation, refund and context checks remain independent. Raw status casing is preserved; only known status semantics are recognized for eligibility. Unknown/missing cancellation or status holds; canceled/refunded/open/processing cases cannot be made ready by a mapping. Any reported refund is held conservatively. The supported reading policy does not imply shipped, completed Reading OS production or delivered status.

Historical safety has two separate fences:

1. Purchased evidence and question identity are authoritative. Display names do not match answers to fields. Current definition evidence is tagged separately and never supplies replacement question identity. Conflicting definition/question identity holds. Unsupported/unknown/dropdown/file evidence remains held even if a seller correction provides text.
2. New source resolution cannot apply an activation to an earlier purchase. Missing receipt creation time or a timestamp before the activation rounded conservatively up to seconds produces ambiguous_historical_mapping and no version. Historical callers must use the server-retained ProductVersion, including ARCHIVED versions; `history.productVersionId=null` never adopts today's active version. That argument must come from owned durable Reading provenance, not a browser claim. No owner historical adoption/import assignment command is added here.

Existing units keep their SQL-protected ProductVersion and append-only customer revisions on replay. Source-bearing initial context is projected from approved question IDs, not caller-provided answer labels. Later config/question/option renames do not replace it. Changed incoming line evidence retains original snapshots and existing sticky source_changed hold. This conservative drift check may hold a reordered/differently displayed observation even though canonical selection meaning is unchanged; it never changes meaning. Quantity expansion stays per line/unit index, independent of the number of buyer questions; quantity>1 still needs per-unit allocation. MANUAL remains manual; ASSISTED admission semantics and no-auto-delivery behavior remain intact.

## Fail-closed conditions

Existing issue arrays/readiness projection are reused, not a new status system. Additional codes: unmapped_purchase_selection, unknown_buyer_input, unresolved_dropdown, unresolved_upload, ambiguous_historical_mapping, source_evidence_incomplete. Existing unpaid/canceled/refund_review/missing_input/unusable_input/quantity_context/source_changed/mapping_paused/unmapped_listing continue to block. Strict malformed/oversized envelope rejection occurs before persistence; a structurally represented unsupported condition remains available for a later controlled hold. No caller should log raw Zod data/customer evidence.

No schema migration is necessary: optional typed snapshot evidence and version-owned policy fit existing JSONB contracts, ownership FKs, mapping uniqueness, immutable published-version and unit-binding triggers. Historical JSON without these fields remains valid. Source snapshots continue to be preserved by existing transactional insert/replay behavior; this milestone does not add a new SQL snapshot trigger. No production database is migrated.

## Validation and remaining debt

Synthetic unit/DB coverage includes separate multiple questions/selections, label/order independence, duplicate/unknown evidence, physical/digital eligibility, missing context, file/dropdown holds, ownership, canonical DB uniqueness, immutable approval, new-versus-historical resolution, pinned replay and quantity. No real customer fixtures, actual upload URLs or fabricated verified dropdown/file encoding are used. Full validation results are recorded in ETSY_REAL_ACCEPTANCE_REPORT.md Part4.

ETSY-INPUTS-01, ETSY-E2E-01 and ETSY-CARDINALITY-01 remain OPEN. Real dropdown/file/grouping/access/expiry, zero/multiple/optional question purchases, historical question changes, third purchase dimension, quantity>1/mixed carts and durable real replay are still evidence debt. A current owned paid MRH receipt predating Product activation cannot simply adopt today's recipe: a separately authorized, explicit historical import/mapping decision is needed before that real intake. The next milestone must define that policy and the verified raw normalizer before controlled ingestion; no live sync/webhook gate is opened here.
