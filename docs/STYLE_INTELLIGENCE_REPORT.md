# Style Intelligence / Previous Work Analysis — Part 1 report

Date: 2026-10-06. Branch: `codex/ui-ux-design-lock`. Starting commit: `da078e1075c3b69ab46623bf2742f511ea6328d9`. Ending commit is the commit containing this report (`feat(style): add versioned style intelligence foundation`); its exact hash is supplied in the final task report.

## Delivered domain

Two additive tables, `style_analysis_versions` and `style_analysis_sources`, belong to the existing seller-style module and stable StyleProfile. Version rows persist organization/store/profile ownership, independent deterministic version numbers, lifecycle, strict typed payload, contract/operation versions, optional owned AIRequest reference, safe failure code and timestamps. Source membership stores exact identities under composite-owned version/source foreign keys, uniqueness and reverse lookup index. Existing source immutability preserves queryable content digests without duplicating historical text.

Contract `style-intelligence/v1` captures voice, tone, opening/development/transitions/closing, diction, sentence/paragraph, personalization, uncertainty, formatting, preferred/avoided patterns and concise guidance. Voice is at most 600 characters; tendency lists at most 6 × 240 characters; guidance at most 8 × 300 characters. Strict Zod objects reject unknown keys, including customer factual fields; TypeScript is derived from the schema. SQL also validates bounded key/type structure. Neither validator claims semantic detection of names/facts embedded in allowed prose. The documented invariant is style evidence only, never historical customer truth.

Lifecycle is transient transaction-only DRAFT assembly, then PENDING → ANALYZING → READY/FAILED, with direct PENDING completion/failure allowed as domain persistence. Deferred sealing prevents committing incomplete assembly. Terminal rows are immutable. Identity/schema versions are frozen and source membership is frozen from PENDING onward. New sources never alter old versions. New analysis means new independently numbered version. Latest attempt and latest usable READY result are separate scoped queries; pending/failed versions cannot displace the usable result.

Referenced sources cannot be removed because provenance must survive; unreferenced source deletion remains unchanged. This conservative retention behavior is documented for later explicit privacy/deletion policy. No seller UI is added or changed.

## Services and security

`analysis-service.ts` adds:

- Create version shell and atomically freeze explicit selected provenance.
- Mark analyzing.
- Strictly validate and complete as READY.
- Record bounded failure as FAILED.
- Read one authorized version.
- Retrieve latest attempt / latest usable READY version.
- Retrieve exact source identities and immutable digest metadata.

Every read verifies persisted membership; every write requires owner access and Store lock. Organization/store predicates and composite foreign keys reject cross-tenant and same-organization cross-store association. Foreign analysis completion/update/source lookup fail; scoped latest queries cannot leak foreign analysis. Audit rows contain resource/action metadata only. AIRequest link checks matching Store/operation and successful status for READY; existing request records supply provider/requested/resolved model provenance. No second ledger, accounting writer or gateway operation is introduced.

## Validation

Runtime for final checks: Node 22.23.1, pnpm 9.7.1. Initial checks also passed on the shell's Node 20 but final checks use the supported runtime.

- `pnpm typecheck`: PASS.
- `pnpm test`: 81 tests / 16 files PASS.
- `pnpm test:db`: 206 tests / 10 files PASS.
- `pnpm build`: PASS.
- Total: 287 passing tests, no failures in final runs; 15 tests added (4 unit, 11 PostgreSQL-engine integration).
- `git diff --check`: PASS.
- Migration `0010_boring_thundra.sql` and generated Drizzle journal/snapshot added. All 11 migrations replayed from scratch in PGlite, including constraints/triggers. Separately replayed with the actual Drizzle PGlite migrator; second invocation was a no-op, 11 journal records retained.

Added tests cover strict and bounded contracts, typed/unknown customer fields, independent version numbering, exact provenance, source-set freezing, source addition/deletion rules, terminal immutability, latest-attempt versus usable semantics, failure preservation, foreign and forged scopes, cross-store associations, owner/operator boundaries, invalid payload rollback, unsealed shell rejection, AIRequest provenance, late audit rollback, zero-network/zero-accounting domain operations and unchanged production context/input hash/prompt. Existing generation/orchestration regression suites also pass. One added synthetic provenance fixture initially failed the existing mandatory AI accounting guard; corrected the fixture to create its existing-ledger metadata transactionally without a provider call. No production guard was relaxed.

PGlite is a PostgreSQL WASM engine; these results are not native PostgreSQL multi-process concurrency or deployment acceptance. No live database migration/deployment occurred. Build-generated tsconfig/next-env changes were reverted to their exact starting contents.

## Preserved scope and remaining work

GenerationContext construction, prompts, hashes, model configuration, production orchestration and seller UI/navigation/onboarding files are unchanged. No Style Intelligence or StyleSource injection occurs. Gemini/real provider calls during this task: **0**. Existing tests use offline fake/mocked providers; analysis domain operations make no AI/provider dispatch and no accounting records. Synthetic AIRequest/UsageEvent rows exist only in the provenance fixture to test references.

Parts 2–4 were not started. Future authorized briefs must add bounded analysis/semantic contamination policy, accounted CentralAIGateway execution and asynchronous workflow, seller controls and explicit version-pinned generation integration. Source budgeting/sampling, retries/recovery, exemplar selection, Review Workspace, PDF/delivery, uploads, embeddings/RAG/fine-tuning and infrastructure remain absent.

Work is committed locally only. No push or deployment. Final clean Git status and exact ending hash are supplied after committing.

## Part 2 continuation

Part 1 remains the historical foundation report above. The subsequent bounded execution milestone is documented separately in [STYLE_INTELLIGENCE_PART2_REPORT.md](STYLE_INTELLIGENCE_PART2_REPORT.md). Its current architecture is the Part 2 section of STYLE_INTELLIGENCE.md; generation consumption and seller UI remain deferred to Parts 3–4.
