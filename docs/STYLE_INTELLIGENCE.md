# Style Intelligence — Parts 1–3

Part 1 delivered durable domain/data. Part 2 now implements explicit bounded analysis execution through CentralAIGateway. Part 3 pins completed intelligence into new customer generations. Seller UI, automatic triggers and analysis workflow/queues remain unimplemented. The Part 1 sections below record its foundation; the Part 2 and Part 3 sections define current execution and generation behavior.

Historical StyleSources → bounded analysis → immutable READY StyleAnalysisVersion → new generation admission → pinned snapshot → immutable GenerationContext → CentralAIGateway → customer reading.

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

At the Part 1 boundary, Parts 2–4 were unimplemented. The Part 2 section below supersedes analysis/execution deferrals; At that boundary Part 3 generation consumption and Part 4 seller workflow remained deferred; Part 3 below supersedes the generation deferral. Exact subdivision will follow their supplied requirements. No chunking/sampling/token budgeting, exemplars, uploads, RAG, embeddings, fine-tuning, review/PDF/delivery or other infrastructure is included.

After Part 1, GenerationContext, instructions, hashes, default model (`gemini-3.5-flash-lite`), production orchestration, seller navigation and onboarding behavior remain unchanged. Neither StyleSources nor Style Intelligence is injected into generation.


## Part 2: executable bounded previous-work analysis

StyleSources → deterministic bounded selection → immutable provenance/input manifest → CentralAIGateway → GenerationProvider/Gemini → structured `style-intelligence/v1` → schema/domain validation + contamination/verbatim guard → READY StyleAnalysisVersion.

`StyleAnalysisExecutionService.execute(scope, {styleProfileId, commandKey, sourceIds?})` is an internal application API, with owner authorization and no HTTP route or seller control. `styleAnalysisRuntime(db)` uses the same centralized runtime configuration, provider abstraction, secret custody, priced model and budgets as `generationRuntime(db)`. Default remains `gemini-3.5-flash-lite`; explicit `AI_GENERATION_MODEL` still takes precedence, including an existing configured 3.8 override. Unknown/unpriced configurations fail closed. There is no provider/model fallback and no implicit retry. This is structured style inference, not training or fine-tuning.

### Exact input policy: style-analysis-input/v1

| Limit | Policy |
| --- | --- |
| Explicit candidate pool | 1–100 distinct StyleSource IDs; all must belong to the authorized Store |
| Automatic pool | Query the authorized Store's oldest sources; return at most 6 bounded prefixes |
| Selected sources | At most 6, ordered by immutable creation time at millisecond precision, then UUID ascending |
| Per-source material | First 6,000 Unicode code points; whole Unicode characters, no broken surrogate pair |
| Aggregate material | At most 24,000 Unicode code points; remaining quota may truncate a later prefix; sources receiving zero quota are excluded |
| Serialized provider-neutral request | At most 192,000 UTF-8 bytes, including platform instructions, JSON envelope and structured schema |
| Output allowance | 8,192 provider output tokens, matching existing gateway policy |

Explicit candidate pool order does not influence selection. SQL validates candidate ownership with metadata only, and reads at most six bounded text prefixes plus original character lengths. It does not load all library text and does not ask AI to select sources. If the library/pool exceeds the cap, only the earliest candidates are considered; sellers can later deliberately select a different pool. If an individual source exceeds 6,000 characters, its prefix is analyzed. If total quota is exhausted, later sources are omitted from frozen membership rather than pretending their text was seen. Prefix selection can miss stylistic habits later in a source; no semantic sampling is claimed.

The existing source membership stores exactly the included IDs. New immutable `inputManifest` stores policy/prompt versions, complete request hash, serialized byte count, output cap and ordered source IDs, original immutable content digest, original/included code-point length, truncation flag and included-prefix SHA-256. Original text is not duplicated. Existing immutable source bodies plus recorded prefix lengths/digests and versioned prompt/schema implementation reproduce the input; a request hash verifies it. Policy/prompt evolution must introduce a versioned implementation, never reinterpret old metadata. Database checks validate bounds, exact membership, actual original lengths and SHA-256 of included prefixes at commit. Request/command/manifest and source memberships are immutable after assembly.

### Prompt and provider output

Fixed `STYLE_ANALYSIS_RULES` is the platform-owned system message (`style-analysis-prompt/v1`). Historical text is separately JSON-escaped user data labeled `UNTRUSTED_HISTORICAL_SOURCE_DATA`; only sample ordinals/text/truncation are sent, with no source titles, internal source IDs or content digests needed by the model. Embedded role/tool/prompt instructions are explicitly inert evidence. The model must describe writing characteristics, omit historical customer truth, avoid quotations and never answer/continue readings or reveal internal instructions. This separation mitigates prompt injection; it does not prove a probabilistic model cannot be influenced.

ProviderRequest gains an optional platform-controlled structured JSON schema. Analysis uses Gemini's documented `responseFormat.text` with `application/json` and JSON Schema; ordinary generation retains its exact existing `responseSchema` sections request. Provider-facing schema derives from strict Zod, keeps required/object/enum/array limits and unknown-property restrictions; unsupported string-length keywords are omitted from the provider schema and remain authoritative in Zod plus system guidance. Gemini support is a subset, not a semantic guarantee. No prose/Markdown JSON scraping occurs. Output bytes are capped at 96,000 before JSON parsing, then strict Zod/domain validation applies. The fake provider emits schema-valid style data only for this analysis contract.

Official references checked 2026-10-06: [GenerateContent API](https://ai.google.dev/api/generate-content) and [structured-output documentation](https://ai.google.dev/gemini-api/docs/generate-content/structured-output). The analysis branch uses the currently documented REST JSON-format field in the same GenerateContent adapter; ordinary generation retains its already accepted sections-schema wire behavior. No real style-analysis provider acceptance is claimed.

### Conservative contamination policy

After strict parsing, the policy inspects every analysis string. It rejects recognizable email addresses, phone-like spans containing at least seven digits, HTTP/www/common domain URLs, social handles, numeric dates (including recognizable DOB formats), English month-date forms, labeled order/reference/receipt/transaction identifiers and UUIDs. There are no structured customer-name columns on StyleSource; explicit `Customer name:`, `Client name:`, `Partner name:` or `Name:` lines in included source text supply conservative exact normalized name checks. Titles are never treated as customer identities. Matched values are not logged or saved as error messages.

The verbatim guard normalizes Unicode NFKC, case and punctuation/whitespace into words. It rejects matching contiguous 12-word windows of at least 60 normalized characters from an included source passage. Short common expressions do not meet the threshold. Checks operate only on bounded included text and bounded validated output, without embeddings, another AI call or a global corpus.

The policy rejects the entire result as `POLICY_REJECTED`; it never removes unsafe spans to manufacture READY. Structural errors become `INVALID_RESULT`. Whitespace trimming belongs to the existing Zod contract and is not semantic sanitization. Guard limitations are explicit: unlabeled names, paraphrased facts, addresses/events/predictions without detectable identifiers, unusual date/URL formats and copied passages below thresholds may escape; legitimate sufficiently long shared prose or labeled names may be conservatively rejected. This is a last-line deterministic guardrail, not perfect semantic privacy protection. Source data should still be appropriately authorized and redacted before submission.

### Attribution, admission, settlement and replay

Operation `style-analysis/v1`, reserved by Part 1, is now first-class in CentralAIGateway. AIRequest gains an owned `styleAnalysisVersionId`; StyleProfile and exact source provenance are reached through that version. Generation ID stays null, attempt number is 1 and no retry parent exists. There is one AIRequest per executable analysis version and one existing UsageEvent per request. Composite references, immutable attribution and deferred bidirectional command/version/request checks enforce these relationships. No new accounting tables or ledger are added.

Under the Store row lock, the service checks owner scope and command replay/conflict, selects/bounds sources, freezes a new version/manifest, reserves/admit through gateway and links ANALYZING to the CLAIMED AIRequest. The provisional UNKNOWN UsageEvent exists before any dispatch. Gateway verifies the exact retained request hash and policy, claims RUNNING transactionally, then dispatches once outside a transaction. Successful response parsing and policy validation precede atomic AIRequest/UsageEvent/analysis/audit settlement. Public Part 1 completion/failure helpers cannot bypass the execution policy for manifest-bearing versions. Settlement of already-authorized dispatched accounting survives later membership revocation; subsequent reads still require current membership.

Reservation uses existing central `reserveCost`: serialized request UTF-8 bytes plus 8,192 schema/envelope allowance as a conservative text-token reservation basis, with configured output cap and frozen selected-model pricing. Byte/character counts are not reported as exact tokenizer usage. Existing Store attempt/daily limits include prior UNKNOWN reservations. Actual reported provider input/output/cached/reasoning usage settles the existing UsageEvent at frozen pricing. Missing usage remains UNKNOWN/null, including an otherwise valid READY result; it is never invented zero. Broader organization/global budgets and provider concurrency/rate hardening remain existing deployment limits.

Versions now have an owned unique UUID command key and normalized command hash. Explicit candidate IDs are sorted for hash compatibility; profile, policy and candidate set remain significant. Automatic selection replay does not re-query today's growing library. Same command returns the retained attempt, including failed budget admission, incomplete state or completed result. Incompatible reuse fails; collisions with existing generation commands also fail. Store locking and PostgreSQL uniqueness/CLAIMED-to-RUNNING state claims suppress concurrent duplicate dispatch across application instances; no in-memory mutex is relied on. Native multi-process acceptance remains a separate validation gate.

### Safe failure and ambiguity

| Outcome | Durable result |
| --- | --- |
| Budget rejection before request admission | FAILED / BUDGET_REJECTED version with frozen manifest; no AIRequest, UsageEvent or dispatch |
| Fake provider forbidden for a non-fixture Store | FAILED / POLICY_REJECTED; no dispatch |
| Invalid/malformed/unknown-field output | FAILED / INVALID_RESULT; paid request/usage retained |
| Contamination/verbatim rejection | FAILED / POLICY_REJECTED; returned usage and charge retained |
| Known provider error | FAILED / PROVIDER_FAILURE; measured or UNKNOWN accounting retained |
| Timeout/network/ambiguous provider failure | FAILED / AMBIGUOUS_EXECUTION; AIRequest ambiguity preserved, missing cost remains UNKNOWN, no retry |
| Crash or settlement failure | Retained ANALYZING with CLAIMED/RUNNING request and UNKNOWN accounting; non-usable; replay never redispatches |

A failed attempt never overwrites the previous latest usable READY version. A crash/expired process is not proof of zero cost and does not authorize another call. No leases, recovery scheduler, broad retries, re-analysis trigger or recurring worker is added. Durable incomplete states require explicit future reconciliation policy; do not advertise ANALYZING as proof that a worker is still alive. A new explicit command creates a new independently numbered analysis, subject to retained-liability budgets.

### Part 2 migration and preserved boundaries

`0011_dusty_madrox.sql` adds three execution fields on analysis versions and one optional analysis reference on AIRequest; no new table. It expands bounded safe failure codes and adds ownership/uniqueness, immutable command/manifest/attribution, manifest/provenance verification and deferred request binding guards. Null execution metadata preserves existing Part 1 domain versions and historical generation accounting. Retain these handwritten guards in future migrations.

At the Part 2 boundary customer GenerationContext, reading prompts/hashes, production queue/scheduling and seller navigation/onboarding/UI remained unchanged. Analysis was not consumed by generation. Part 3 below supersedes only the generation deferral; no exemplars or sources are injected and seller workflow/UI remains Part 4.


## Part 3: admission-time generation pinning

`GenerationService` resolves intelligence exactly once in the **new Generation insertion** branch, after owner or trusted production authority verification and under the existing Store row lock. `pinStyleIntelligenceInTransaction` resolves the stable StyleProfile through the admitted published StyleProfileVersion and an owned profile join; filters organization, Store, profile and READY; then orders by independent analysis version number descending. No command accepts a caller-selected analysis ID. Same-organization sibling stores remain isolated. This trusted transaction reader is not a standalone public authorization API.

The existing context receives optional `styleIntelligence: {analysisVersionId, versionNumber, contractVersion, payload}`. The strict Zod snapshot requires `style-intelligence/v1` and validates its complete bounded payload. No input manifest, source membership or source text enters the snapshot. No new table/relation/migration is needed: existing immutable Generation JSONB is authoritative, including after later source/analysis retention changes. An invalid persisted READY payload fails closed before paid dispatch rather than sending invalid guidance.

### Compatibility, hashes and admission semantics

This is an additive optional extension of `personalized-content-v1`, not a new engine contract. Existing fields and canonical section/output semantics are unchanged. Missing means admitted without intelligence; the property is omitted, never backfilled or resolved during execution. Historical JSON/hashes are not rewritten; old contexts execute with the exact previous system instruction and envelope. Contexts with intelligence include both snapshot metadata and payload in existing stable canonical JSON/SHA-256, so another pinned version changes the hash even if its payload matches.

No READY version → manual style path, without waiting or errors caused merely by absence. Newer PENDING/ANALYZING/FAILED → latest older READY. Analysis completing after admission cannot enrich an existing Generation. A later new reading can use the later READY. Existing command replay returns retained state; Store locking serializes concurrent admission and analysis completion. Queue waiting admission/scheduler eligibility is not Generation admission and does not select intelligence. The snapshot is selected when the actual new Generation is durably created.

Manual retries, production retries and undispatched production command resume retain the original context/hash. Current eligibility checks still validate customer/product revisions but never select latest intelligence. Pre-dispatch validation, GenerationService execution and prompt assembly do not read StyleAnalysis or StyleSources. There is no automatic analysis or extra AI call for selection, and no change to ambiguity/recovery/retry limits.

### Prompt priority and trust

For enriched contexts only, a fixed platform-owned rule explains priority: platform safety/output contract → configured product sections and requirements → explicit seller style configuration → analyzed writing tendencies. Current customer answers supply the sole customer evidence; they remain untrusted data, not instruction authority. Intelligence supplements seller settings (for example explicit concise detail beats learned verbose tendencies), cannot change product sections, and is never historical customer truth.

The existing JSON data envelope adds only `styleIntelligence: payload`. IDs, version metadata, source bodies, source titles/identifiers, analysis input manifests and reading exemplars are not sent. The payload stays untrusted configuration/data; embedded instructions cannot supersede platform rules. Zod is authoritative for structure/bounds; Part 2 contamination guards remain a conservative admission policy, not a guarantee against every semantic leak. Exact configured section IDs/titles still pass existing canonical output validation.

### Cost and remaining scope

Existing gateway admission receives UTF-8 bytes of the exact assembled system plus data request, including added intelligence and priority instruction. Central pricing/reservation, input byte cap (256,000), output allowance, budget checks and actual usage settlement remain unchanged. No fixed assumed intelligence-token cost or second ledger is introduced. Existing Generation context hash covers the snapshot; command hashes retain their original command identity semantics. Generation has no new separate provider-request hash field.

Seller-facing workflow/UI remains **Part 4**, unimplemented: no analyze button, preview/status, onboarding step or navigation change. Source/exemplar injection, automatic/recurring analysis, fallback, uploads, embeddings/RAG/fine-tuning remain excluded. Real Gemini calls during Part 3 validation: zero; only fake providers or mocked transports.
