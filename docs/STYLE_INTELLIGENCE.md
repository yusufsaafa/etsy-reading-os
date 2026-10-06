# Style Intelligence — Part 1 foundation

Implemented scope: durable domain/data only. No analysis execution, source-text analysis, gateway call, workflow/queue, seller UI or generation integration is implemented.

Historical StyleSources → **future bounded analysis** → immutable StyleAnalysisVersion → **future GenerationContext**.

## Ownership and representation

The existing `modules/seller-style` domain owns two additive tables:

- `style_analysis_versions`: organization/store ownership, existing stable StyleProfile reference, independent positive version number, lifecycle, structured payload, contract/operation versions, optional owned AIRequest reference, safe failure code and creation/start/completion timestamps.
- `style_analysis_sources`: exact organization/store/version/source membership with unique membership and composite foreign keys on both ends. Queryable provenance returns IDs, immutable source content digests/type/creation times, without loading source text.

No extra stable StyleAnalysis identity is needed: StyleProfile already supplies the stable parent. Analysis numbering is independent of published StyleProfileVersion numbering. Store locking serializes application allocation; the per-profile version uniqueness constraint rejects competing duplicate numbers. Latest queries order by version number, never timestamp ties. Creation is an explicit domain operation; adding previous work has no analysis trigger.

## Compact writing DNA contract

Strict Zod `styleIntelligence` derives `StyleIntelligence`. Contract identifier: `style-intelligence/v1`; operation identifier: `style-analysis/v1`. Fields:

| Field | Bounds |
| --- | --- |
| Voice summary | 1–600 characters |
| Tone, diction, sentence/paragraph, personalization, uncertainty, formatting, preferred/avoided patterns | Each 0–6 entries, 1–240 characters per entry |
| Structure: opening, development, transitions, closing | Each 0–6 entries, 1–240 characters per entry |
| Generation guidance | 1–8 entries, 1–300 characters per entry |

All fields are required; empty tendency arrays permit insufficient evidence without fabrication. All objects reject unknown keys. No recursive structures, customer fact fields or giant freeform analysis field exist. The SQL payload check enforces the same key/type/item bounds for direct database writes. Zod trims strings at the application boundary; database length checks measure trimmed values. Future contract revisions require an explicit schema/migration change.

**STYLE-LEVEL ONLY. Previous work is evidence of how the seller writes, not truth about future customers.** Do not intentionally preserve historical names, DOBs, partners, questions, events, predictions, outcomes, addresses/contact details, order identifiers or any other source-specific customer facts. Describe acknowledgment, diction, uncertainty and explanation habits rather than historical subject matter or conclusions. Strict validation catches unexpected factual fields, but cannot detect every name or fact hidden inside an allowed string. Semantic contamination policy/validation belongs to future analysis work.

## Lifecycle and version safety

`DRAFT` is a transaction-internal assembly state only. The creation transaction inserts selected membership then seals it as `PENDING`. A deferred database trigger rejects commits containing DRAFT or fewer than 1/more than 100 source memberships. Source sets cannot be extended, replaced or removed after sealing. Selection rejects duplicate source IDs.

Committed lifecycle: `PENDING → ANALYZING → READY | FAILED`. Domain completion/failure may also transition directly from PENDING; these persistence operations never simulate or invoke analysis. No lease, worker, retry, recovery or execution claim is implied by ANALYZING.

READY and FAILED are terminal immutable records. Completed content, source set, contract/operation identifiers, identity, timestamps and AIRequest association cannot be changed/deleted. Any re-analysis creates a new version. Failed attempts retain metadata only and cannot overwrite any previous usable payload. `latestStyleAnalysisAttempt` returns the greatest version regardless of state; `latestUsableStyleAnalysis` filters READY first. No mutable usable pointer is necessary.

Selected StyleSources are already immutable. Restricting foreign keys prevents deletion of referenced source records; unreferenced sources retain existing deletion behavior. This is a deliberate conservative retention consequence: no historical provenance is silently erased or replaced with today's library. A future privacy/deletion policy must explicitly reconcile retained evidence with immutable provenance before introducing real customer data. The existing seller UI is unchanged.

## Future AI provenance

The optional composite-owned `aiRequestId` references existing CentralAIGateway/accounting records. Their `provider`, `model` (requested), `resolvedModel`, request identity and operation provide durable model provenance without a second usage ledger or copied pricing fields. If linked, the request must belong to this Store and matching analysis operation; a READY analysis requires that linked request to have SUCCEEDED. Null permits standalone domain persistence without requiring a provider call. Part 1 never creates an AIRequest or usage event. Future analysis execution must use CentralAIGateway and its existing accounting; its operation acceptance/execution integration is not implemented here.

## Service and security boundaries

`analysis-service.ts` provides create shell + frozen provenance, mark analyzing, validate/complete, record safe failure, read owned version, latest attempt, latest usable, and exact source provenance. Every public read verifies persisted membership; every mutation verifies owner authority and locks Store. Every query/write scopes organization and Store. Composite foreign keys enforce Store/Profile, Store/Source and Store/AIRequest ownership including stores within the same organization. Audit events contain action/actor/resource identity only, never source or payload content.

No caller can attach foreign sources, change another Store's analysis or obtain its usable result using a guessed identifier. Database constraints supplement application authorization; no new RLS claim is made.

## Migration and future boundaries

`0010_boring_thundra.sql` adds the two tables, unique/version/provenance constraints, latest/reverse indexes, strict payload validator, transition/history/source guards and deferred sealing validation. Retain handwritten functions/triggers when generating later migrations; Drizzle snapshots do not encode them.

Parts 2–4 remain unimplemented: bounded source analysis and semantic policy; accounted gateway execution and asynchronous workflow; seller controls and eventual explicit version-pinned generation consumption, as authorized by those future briefs. Exact subdivision will follow their supplied requirements. No chunking/sampling/token budgeting, exemplars, uploads, RAG, embeddings, fine-tuning, review/PDF/delivery or other infrastructure is included.

After Part 1, GenerationContext, instructions, hashes, default model (`gemini-3.5-flash-lite`), production orchestration, seller navigation and onboarding behavior remain unchanged. Neither StyleSources nor Style Intelligence is injected into generation.
