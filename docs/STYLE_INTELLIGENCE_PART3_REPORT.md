# Style Intelligence — Part 3 report

Branch: `codex/ui-ux-design-lock`. Required starting commit: `06cb37c04cb8710ecb98b456f8add4923fa6b37c`. Completed changes are committed as `feat(style): pin style intelligence into generation context`; the ending SHA is reported in the task response (a commit cannot contain its own SHA).

## Implementation

- GenerationContext adds optional strict `styleIntelligence` with analysisVersionId, independent versionNumber, contractVersion and bounded `style-intelligence/v1` payload.
- New-generation admission alone selects latest owned READY by version number, through the admitted published style version's persisted stable StyleProfile relationship. Existing authority checks and Store row lock apply. Both owner preparation and ASSISTED production execution share this branch.
- No READY leaves the exact manual-style context and prompt unchanged. Newer FAILED/ANALYZING/PENDING attempts never hide an older READY.
- Existing v1 context compatibility is additive. Old rows/hashes remain unchanged. Missing intelligence is a frozen admission decision, never an invitation to fetch later. Existing immutable JSONB and context hash are authoritative; no schema/migration or floating relation is added.
- Prompt assembly validates the snapshot and puts only its payload in the untrusted JSON envelope. A fixed conditional platform rule prioritizes platform contract, product requirements, explicit style settings, then learned writing tendencies. Current answers are the sole customer evidence. Product output section IDs/titles remain validated.
- Retries, command replay, undispatched resume and pre-dispatch eligibility checks never resolve latest analysis. Later analysis publication/failure cannot change existing context/hash.
- Persisted organization/Store/profile predicates and owned published-style joins prevent cross-store or wrong-profile pinning. No client-selected analysis ID is accepted. The existing one-StyleProfile-per-Store constraint remains intact; forged generation commands are strict-schema rejected.
- Existing gateway reserves from exact enriched system/data bytes at centralized pricing, enforces its existing input/output/budget limits and settles actual usage through existing AIRequest/UsageEvent. No extra AI call, model policy, provider fallback or accounting path.

## Tests

New focused coverage in generation unit/DB tests and production recovery DB tests covers: strict bounded snapshot validation; untrusted injected guidance; explicit style priority; deterministic latest READY despite newer failed/pending/analyzing attempts; exact no-READY/manual compatibility; complete frozen payload; no historical text/identifiers/manifests sent; exact product sections; context hashing; priced reservation from exact enriched bytes; retry/replay retention with and without an initial pin; later new reading adopting newer READY; READY becoming available between admission and execution; foreign tenant and same-organization Store isolation; forged IDs; immutable snapshots; concurrent enriched commands; one dispatch/ledger; production retries not querying latest.

Existing analysis and foundation boundary tests now enforce their still-current persistence/eligibility boundaries rather than prohibiting explicitly authorized Part 3 prompt integration. Existing generation, migration replay, tenant, accounting, ambiguous failure, product/customer revision, production scheduling and recovery regression suites remain active. All fixtures are synthetic; fake providers or injected mocked transports only.

## Validation

All required checks passed under supported Node 22.23.1:

| Check | Final result |
| --- | --- |
| pnpm typecheck | PASS |
| pnpm test | 108 tests, 17 files PASS |
| pnpm test:db | 248 tests, 11 files PASS |
| pnpm build | PASS, production webpack build |
| Total tests | 356 tests, 28 files PASS |
| git diff --check | PASS |

Build-generated Next TypeScript configuration changes were restored to the base versions and typecheck passed afterward. No migration is added; the existing migration runner/replay tests remain part of the DB suite. Initial failures were obsolete pre-Part-3 static assertions and two new fixtures using UUID Etsy external IDs; assertions were scoped to the current boundary and fixtures corrected to the existing numeric ID contract. A strengthened foreign published-style fixture also needed its required seller identity; this was supplied without weakening application validation.

## Preserved boundaries and remaining work

Historical StyleSources, exemplars, source provenance/input manifests are **not** sent to customer generation. Analysis is **not** automatically triggered by admission, source creation or retries. No seller-facing file, navigation, onboarding, control or workflow changed. Real Gemini generation/analysis calls during this task: **0**. No push or deployment.

Part 4 remains: authorized seller workflow/UI for explicit analysis requests, selection/status/preview and safe failure presentation, using the internal services and existing tenant/accounting constraints. No Part 4 implementation is included. Semantic quality/live style-analysis acceptance remains unclaimed; deterministic guardrails and prompt priority do not prove probabilistic model compliance.
