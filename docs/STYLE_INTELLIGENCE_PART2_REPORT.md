# Style Intelligence / Previous Work Analysis — Part 2 report

Date: 2026-10-06. Branch: `codex/ui-ux-design-lock`. Starting commit: `3cace3f3617e59e015b401c5c02292b54b529b20`. Ending commit is the commit containing this report (`feat(style): execute bounded style intelligence analysis`); the exact hash is returned after committing.

## Delivered flow

StyleSources → deterministic bounded selection → immutable exact provenance/input manifest → CentralAIGateway → GenerationProvider/Gemini → structured style-intelligence/v1 → Zod/domain validation + deterministic contamination/verbatim guard → READY StyleAnalysisVersion.

`StyleAnalysisExecutionService.execute(scope, {styleProfileId, commandKey, sourceIds?})` is an owner-authorized internal API. `styleAnalysisRuntime(db)` shares existing runtime/provider/model/budget configuration with generation. There is no route, seller control, source-paste trigger, queue or recurring execution. This is structured style inference, not training or fine-tuning. Parts 3–4 were not started.

## AI operation and attribution

The Part 1 reserved identifier `style-analysis/v1` is now a first-class gateway operation. AIRequest references its composite-owned StyleAnalysisVersion; stable StyleProfile and exact source provenance are reached through that version. Generation ID remains null, attempt number is 1 and retry parent is null. Deferred bidirectional binding checks validate command hash/key, operation and version/request association. Existing request and usage history guards remain intact. No second gateway, usage ledger or price registry exists.

## Exact source/input policy

- Explicit source candidate pools: 1–100 distinct IDs, every candidate must be owned by the Store.
- Automatic selection: oldest sources first, creation time normalized to milliseconds then UUID ascending.
- At most 6 candidate prefixes fetched; original text is never loaded wholesale from the entire library.
- First 6,000 Unicode code points per source; total at most 24,000 code points. Later prefixes are shortened to remaining quota; zero-quota sources are excluded from frozen membership.
- Provider-neutral serialized request: at most 192,000 UTF-8 bytes including system/data/schema. Output allowance: 8,192 tokens.
- Input manifest freezes prompt/policy versions, exact complete request SHA-256, byte count/output cap and ordered per-source ID/full immutable digest/original length/included length/truncation/included-prefix digest. Text is not duplicated.

Existing exact source membership remains frozen. SQL commit checks verify manifest membership, original lengths and included-prefix hashes against actual immutable sources. Later sources cannot change old attempts. Truncation is deterministic prefix selection, not semantic sampling; it can omit writing habits later in a source.

## Prompt, structured output and policy

The platform-owned system instruction defines style-only analysis, rejects historical facts and tells the model not to obey embedded role/tool/prompt commands, answer/continue historical readings or reveal internal instructions. Source text is separately JSON-escaped untrusted user data. Titles, internal source IDs and digests are not sent to the provider.

Gemini analysis uses the documented REST `responseFormat.text` JSON/schema field through the existing adapter. The schema derives from strict Zod and retains supported object/required/enum/array constraints; application validation enforces all string bounds and unknown-field rejection. Ordinary generation retains its existing `responseSchema` sections wire contract. No Markdown/prose JSON extraction occurs. Fake analysis output satisfies the real contract. Official references and verification date are in STYLE_INTELLIGENCE.md; real analysis compatibility/quality is not claimed from mocks.

After bounded JSON parsing and strict style-intelligence/v1 validation, deterministic checks reject obvious emails, phone-like numbers, contact URLs/handles, recognizable dates/DOB forms, labeled order/reference identifiers, UUIDs and explicitly labeled historical customer/partner names. Verbatim detection compares normalized contiguous 12-word windows of at least 60 characters. Short common expressions pass. Policy rejection fails the entire result; no semantic sanitization creates READY.

These are conservative last-line guards, not perfect NLP or privacy detection. Unlabeled names, paraphrased historical facts, unusual identifier formats and copying below thresholds can escape; legitimate long common passages can be rejected. Prior work remains style evidence, never reusable customer truth. Input should be appropriately authorized/redacted.

## Admission, accounting and duplicate safety

Owner/Store locks serialize command replay, bounded selection, version allocation, frozen metadata and central reservation. UNKNOWN UsageEvent and CLAIMED AIRequest commit before dispatch. Gateway checks the frozen request hash, model/output policy and exclusive state claim before one provider call outside the transaction. Successful structured validation/policy precedes atomic request/usage/version/audit settlement.

Reservation reuses exact selected-model centralized pricing and the existing conservative byte-plus-envelope strategy; characters/bytes are not fake exact tokenizer accounting. Returned usage settles measured estimates; missing usage remains UNKNOWN/null. Previous unresolved liability continues consuming configured budgets. No automatic model/provider fallback or implicit retry exists.

The Store-owned UUID command and normalized hash support durable replay. Explicit candidate order is normalized; changed profile/candidate set/policy conflicts. Same command returns its existing version even after library growth, budget rejection, completion or failure. Concurrent identical commands converge before paid dispatch using database locks, uniqueness and CLAIMED→RUNNING fencing; no in-memory mutex is relied on. Executable versions cannot be completed through the Part 1 public persistence helper to bypass policy.

## Failure and ambiguity

- Budget rejection: durable FAILED/BUDGET_REJECTED version; no request, usage event or call.
- Non-fixture Store with fake provider: durable policy rejection before dispatch.
- Invalid output: FAILED/INVALID_RESULT, retaining request/usage.
- Contamination/verbatim: FAILED/POLICY_REJECTED, retaining reported charges.
- Known provider error: FAILED/PROVIDER_FAILURE with measured or unknown accounting.
- Timeout/network/ambiguous provider error: FAILED/AMBIGUOUS_EXECUTION with ambiguity and unknown liability retained; replay never redispatches.
- Crash/settlement failure: durable non-usable ANALYZING plus CLAIMED/RUNNING/UNKNOWN state. No automatic recovery/retry or zero-cost fiction.

Older READY versions remain available through the existing latest-usable lookup. Authorized dispatched settlement survives later membership revocation; subsequent reads continue verifying current authorization.

## Schema/migration

`0011_dusty_madrox.sql` adds `command_key`, `command_hash`, `input_manifest` on existing analysis versions and nullable `style_analysis_version_id` on existing AIRequest. No new tables. It expands bounded failure codes and adds owned reference/uniqueness, immutable execution metadata/attribution, bounded manifest/source verification and deferred request binding. Existing Part 1 versions and historical generation rows retain null new execution fields without backfill or rebinding. Keep handwritten guards during future migration generation.

All 12 migrations replayed from scratch through the actual Drizzle PGlite migrator. Reapplication was a no-op and retained 12 migration journal records. `pnpm db:generate` reports no pending schema changes. Existing populated-generation/accounting migration preservation remains tested. The historical Part 3 snapshot fixture excludes only the newly added nullable AIRequest column when restoring into its old schema, then additionally verifies the new style migrations preserve old history and fabricate no analysis.

## Tests and validation

Final runtime: Node 22.23.1, pnpm 9.7.1.

| Check | Result |
| --- | --- |
| pnpm typecheck | PASS |
| pnpm test | 107 tests / 17 files PASS |
| pnpm test:db | 235 tests / 11 files PASS |
| pnpm build | PASS |
| Total | 342 passing tests |
| Added | 55 tests: 26 unit/adapter, 29 PostgreSQL-engine integration |
| Migration replay/repeat | PASS; 12 records, repeat no-op |
| git diff --check | PASS |

Coverage includes deterministic/count/per-source/aggregate/Unicode/ordering bounds; exact immutable provenance/truncation/hash metadata; injection trust boundary; strict malformed/unknown/bounded output rejection; identifier/name/verbatim contamination and common-phrase resistance; schema-valid fake output and mocked Gemini JSON schema; priced runtime/default/override/fail-closed behavior; known/ambiguous failures; successful and failed accounting; missing usage/unknown liability; budget-before-dispatch; one request/usage per attempt; durable replay/conflicts/concurrent duplicate suppression; last usable preservation; tenant/Store/operator isolation; request-hash fencing; accounting/settlement rollback; authorized settlement after membership revocation; and actual customer generation context/hash/prompt equality after successful and failed executable analyses. Tests forbid real network calls at the style integration boundary; adapter tests use injected mocked transports.

Initial failures were corrected without relaxing production validation: a Part 1 static assertion matched the word gateway in a new persistence-helper comment; the old migration snapshot attempted to copy a column absent from its historical schema; typing on the added history assertion required an explicit query row type. Final tests/checks above pass.

PGlite is PostgreSQL WASM, not native multi-process concurrency or deployment acceptance. No live database migration or real Gemini analysis was run. Build-generated tsconfig/next-env changes were restored to exact starting contents and final typecheck passed.

## Preserved boundaries and remaining work

GenerationContext construction, customer reading instructions/hashes, GenerationService, production queue/scheduling/recovery modules, seller UI/routes/navigation and onboarding are unchanged. Existing default remains gemini-3.5-flash-lite with explicit configuration overrides; centralized pricing is unchanged. Gemini adapter changes are conditional on analysis structured output, so reading requests preserve their accepted schema.

Real Gemini style-analysis attempts during this task: **0**. No live acceptance harness, push or deployment was executed. Git status is verified after the local commit and supplied in the final task response.

Part 3 remains explicit version-pinned Style Intelligence consumption in customer generation. Part 4 remains seller-facing analysis workflow/UX. No exemplar injection, automatic/recurring analysis, broad retries, embeddings/vector database/RAG/fine-tuning, uploads, review/PDF/delivery/Telegram/billing or new infrastructure is included. Existing global budgets/rate hardening, operator reconciliation/retention policy and native/provider acceptance remain documented operational limitations, not completed features.
