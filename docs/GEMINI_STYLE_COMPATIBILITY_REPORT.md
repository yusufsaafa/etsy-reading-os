# Gemini style structured-output compatibility correction

Starting commit: b31123eac5060859e330886120966ad75ad25daf. Branch: codex/ui-ux-design-lock. Ending commit is reported in the task response.

The historical style-host-20261006-01 remains immutable FAILED evidence. Its exact Google rejection was discarded, so this correction does not prove its root cause. Official REST documentation defines the newer responseFormat.text.mimeType as an enum (APPLICATION_JSON), whereas analysis emitted application/json. This is a specific compatibility suspect. Google also still documents responseMimeType/responseSchema (deprecated), the mechanism previously live accepted by customer generation on the configured model. The fetched model table did not explicitly identify gemini-3.5-flash-lite; no new model-specific live support is claimed.

Old analysis: responseFormat.text.mimeType=application/json and JSON Schema. New analysis: responseMimeType=application/json plus provider-compatible responseSchema. The deterministic boundary projection converts types to uppercase, recursively retains nested properties/items, required and enum, transforms const to singleton enum, converts min/max array counts to REST int64 strings and retains descriptions. $schema/additionalProperties/string lengths and other unused keywords are omitted; union/nullable structures fail closed. The canonical style-intelligence/v1 contract is unchanged and remains authoritative for strict unknown-field rejection, bounds, domain checks, contamination and verbatim guards.

Nullable AIRequest providerHttpStatus and googleErrorStatus preserve only HTTP status and allowlisted Google categories. Historical rows remain null. No arbitrary provider body/message, request, prompt, source, credential or header is persisted. The harness additionally reports normalized request/analysis failure, ambiguity and these diagnostics. Migration 0012_smooth_grandmaster adds two nullable columns; no new ledger.

Failure classification, ambiguity, budget/reservation, actual-usage settlement and unknown/null accounting are unchanged. No automatic retry/fallback or model change. Customer generation request shape, Part 3 immutable admission pinning and Part 4 seller workflow are unchanged.

New tests cover deterministic projection, nested schemas/enums, omission and fail-closed unions, 400/401/403/429/500/503 rejection diagnostics, unrecognized categories, malformed error bodies, network/timeout metadata, absence of raw messages/secrets, exact generation request regression, persisted diagnostics, one-request/one-event replay, unknown cost, repeat migration preservation. Existing strict validation, guards, pinning and seller workflow tests remain active.

Offline acceptance: READY; contract validated; one fake dispatch, zero real dispatches; one SUCCEEDED AIRequest; one settled known-zero UsageEvent. Added diagnostics are safely null on success. No --live run, no new live attempt, no change to the historical marker/database. Live acceptance remains pending separate authorization.

Future command only, NOT executed (requires reviewed fix, explicit authorization and fresh marker preflight):

```sh
node --env-file=.env.local --import tsx scripts/style-analysis-acceptance.ts --live --attempt-id style-host-20261007-02
```

Official references and projection details: STYLE_INTELLIGENCE.md, Gemini compatibility correction section.

Final validation: pnpm typecheck PASS; pnpm test 133 tests/19 files PASS; pnpm test:db 257 tests/11 files PASS; pnpm build PASS; offline harness PASS; git diff --check PASS. Total: 390 tests/30 files. Migration replay from scratch and repeat no-op passed. An initial historical snapshot fixture copied new columns into an old schema; its restoration projection was corrected, null historical diagnostics asserted, targeted production-recovery tests passed (33), then the entire DB suite passed. Build-generated TypeScript configuration edits were restored and typecheck passed afterward. Real Gemini calls: 0. Nothing pushed or deployed.
