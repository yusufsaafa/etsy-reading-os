# Generation engine implementation report

Date: 2026-10-05. Branch: `codex/ui-ux-design-lock`. Exact base: `d10e6fe0f98c8e7381e9f2528a1bb4358bc3f77b`.

**Implemented and locally committed; backend/build checks pass. Native PostgreSQL and browser acceptance are incomplete because this execution environment rejects shared memory, local sockets and server listeners. This is not a production acceptance claim.**

The detailed contract, official pricing references, diagrams-free pipeline description, configuration and recovery semantics are in [GENERATION_ENGINE.md](GENERATION_ENGINE.md).

1. **Architecture implemented.** Tenant-owned Reading → deterministic admission/context → GenerationService → CentralAIGateway → provider-neutral GenerationProvider → validated canonical content → atomic result/accounting settlement. Future queue workers can invoke the same non-HTTP command.

2. **Domain/schema changes.** Three new tables: generations, ai_requests (also the attempt history), usage_events. 24 tables total. Existing unit/config/style/context concepts are reused. No redundant attempt, mapping, source-selection or readiness table.

3. **Migration.** Additive 0005_green_mindworm.sql plus Drizzle snapshot/journal. Composite ownership FKs, command/attempt uniqueness, per-reading/per-generation active partial indexes, snapshot/history protection and deferred accounting/parent-lineage checks. No previous migration is edited; no existing reading is rebound or given fabricated content.

4. **GenerationContext.** Exact unit/line/order IDs; retained product version/configuration; admitted active style version/configuration; bounded seller identity snapshot/reference; exact customer revision/answers; engine version and stable JSON SHA-256.

5. **Version/snapshot binding.** Product stays on the unit's original published version even after new activation. Style is frozen when generation is admitted. Seller ID/name/bio are copied once. Retried work preserves the original context; historical rows cannot be silently rewritten.

6. **Lifecycle.** PROCESSING → SUCCEEDED/FAILED. Existing operational holds take precedence over Preparing/Ready for review/Problem. Revised customer information projects Review updated information. Queue, approval, document and delivery states are deliberately absent.

7. **Provider abstraction.** Vendor-neutral request/response/usage/failure types; feature/domain code imports no vendor types and invokes no provider SDK directly.

8. **Concrete provider.** Google Gemini via documented REST generateContent, one physical fetch, explicit timeout, structured JSON response schema, normalized usage/errors, no tools/grounding/files and no hidden retries. Fake provider is deterministic and development/fixture-gated. No dependencies or lockfile changes.

9. **CentralAIGateway.** Durable intent plus provisional UNKNOWN accounting before dispatch, policy/budget verification, single state claim, timing/correlation/usage/model capture, centralized frozen-price calculation and atomic settlement.

10. **Prompt boundary.** Fixed platform instructions in the system role; seller/style/product/customer material in one JSON user-data envelope. Customer text cannot become a supplied system prompt. Residual prompt-injection risk is documented; no perfect-prevention claim.

11. **Canonical schema.** One sections array, each section containing sectionId/title/content. Stable IDs and titles come from the exact ProductVersion. No second PDF/content generation exists.

12. **Structured validation.** Zod plus deterministic identity/title/count checks reject malformed JSON, unknown/missing/duplicate sections, empty content, unexpected fields and bounds violations. Failed validation still retains attempt usage/cost.

13. **AIRequest.** One row per attempt: tenant, operation, generation/ordinal, command/hash/parent, provider/requested+resolved model, provider request ID, usage categories, duration, status/failure/ambiguity, pricing/reservation/cost state and timestamps.

14. **Usage/cost.** One UsageEvent per request, created before invocation. Request/Generation/unit/line/order relationships enable attribution and aggregation, including failed attempts. Scoped generation totals expose a partial known sum and hasUnknown.

15. **Money.** Integer USD nanos, BigInt arithmetic and PostgreSQL bigint. $1 = 1,000,000,000 nanos. Provider invoice cost remains null; estimates are never labeled exact invoices.

16. **Pricing/source.** Official Google model, pricing and generateContent docs verified 2026-10-05. Central model: gemini-3.8-flash. Standard paid text input/output $0.75/$3.75 per million through 2026-12-31; documented 2027 prices $1.50/$7.50. Cached input handled separately. Every request stores its pricing version/source/rates/result. See linked official sources in GENERATION_ENGINE.md.

17. **Failed accounting.** Returned usage can produce an estimated charge on a failed call or invalid result. Missing usage is null/unknown, never invented zero. Deterministic non-dispatch rejection is known zero. Unknown liability retains its reservation.

18. **Idempotency.** Store-scoped UUID command uniqueness and exact payload hash. Same command returns the saved generation/state without another call. Same key with different parameters fails. Different keys cannot replace successful work in this slice.

19. **Concurrency.** Store-row locks plus DB uniqueness/partial indexes protect claims and concurrent reservations; no in-process mutex. Tests cover simultaneous identical submissions and replay while delayed provider work is in progress. Multi-instance native PostgreSQL execution could not be demonstrated here and remains an acceptance gate.

20. **Retries/attempts.** Explicit new command and original failed Generation ID; ordinal/parent-linked attempt; unchanged original context; at most three attempts. Ambiguous prior execution and changed customer revision block retry. No automatic retries, scheduling, regeneration or history overwrite.

21. **Transactions.** Claim/admit commit; claim/recheck commit; external call with no DB transaction open; atomic result/usage/accounting/audit commit. Crash/settlement failure leaves durable active state plus unknown accounting. Replay never redispatches; operator reconciliation is required, with queue recovery deferred.

22. **Tenant/security.** Every public read/command verifies membership/store scope; paid commands require owner. Composite relationships reject cross-store links. The fake runtime additionally checks the actual fixture Store. Model text selects no authorization or resource IDs.

23. **Privacy/logging.** No full prompt/customer/style/source/result bodies in AuditLog or accounting. Provider errors become bounded safe codes. Canonical bodies/context are private domain records; React escapes output. Provider secret stays in a server-side header/environment. Retention/reconciliation remains a production policy gate.

24. **Seller UI.** Minimal Prepare reading/Preparing/Try preparing again form and canonical section inspection in existing reading rows. Contextual profile/style setup link, restrained operational status/attention integration and stale-context notice. No visual redesign, provider settings, AI playground or Review Workspace.

25. **Tests added.** 48: 37 database and 11 unit/adapter/projection/architecture tests. Admission/config/customer holds, exact old/current version behavior, seller snapshots, full output rejection matrix, measured/unknown/failed cost, retries, simultaneous commands, tenant reads/mutations/FKs, delayed customer correction, accounting failure before dispatch, settlement failure after dispatch, budgets, no sources in requests, migration preservation/replay, seed replay and fake runtime gating. Existing assertions were not weakened.

26. **Total tests.** 144 passed: 49 unit/security/adapter tests plus 95 database tests. Original 96 remain green. No test performed an external AI request; adapter tests use an injected mock transport and generation tests use a deterministic provider.

27. **pnpm typecheck.** Passed, exit 0, strict settings preserved. Next-generated next-env.d.ts/tsconfig.json changes were restored and typecheck repeated successfully.

28. **pnpm test.** Passed, exit 0: 9 files / 49 tests.

29. **pnpm test:db.** Passed, exit 0: 5 files / 95 tests, PostgreSQL engine through PGlite.

30. **pnpm build.** Passed, exit 0: optimized webpack compilation, TypeScript, route generation and build traces. No key/database/network/provider is needed at build time. Drizzle generation check reports no pending schema changes; git diff --check passes.

31. **Native PostgreSQL migration/replay.** Not completed. Isolated initdb attempted under /tmp/reading-os-generation-pg, including mmap settings; both failed with shmget Operation not permitted. Connection to the existing local PostgreSQL socket was also rejected with Operation not permitted. No production DB was used. PGlite's real migrator applied and replayed all migrations successfully; separate tests preserved pre-generation configured/seller/style/order rows.

32. **Fixture seed/replay.** Equivalent existing fixture seed service sequence executed twice through PGlite and preserved six orders, seven lines and ten reading identities. Original #2002 remains Love ×2 + Career ×1, three independent readings. Native pnpm db:seed/replay is blocked by the same DB environment restriction and is not claimed executed.

33. **Manual acceptance.** Real Auth.js sign-in and rendered click/reload journey not completed. pnpm dev --port 3105 failed with listen EPERM on 127.0.0.1:3105, preventing a browser against this checkout. Backend integration tests instead exercised eligible preparation, PROCESSING replay, persisted canonical sections/readback, exact bindings, tenant denial and mixed-cart independence. They are not a substitute for visual/native acceptance. The remaining step-by-step manual journey is documented in GENERATION_ENGINE.md.

34. **Live acceptance.** Live provider acceptance not executed because credentials were not available. GEMINI_API_KEY is required, plus explicit google provider/budgets and an isolated synthetic eligible reading. The opt-in script's missing-credential path was run successfully with node --import tsx and made zero calls. tsx's CLI IPC itself is restricted in this environment; the documented Node import path avoids that extra listener.

35. **Known limitations.** Abandoned-processing recovery, provider reconciliation, organization/global budgets/rate controls and multi-instance native acceptance are not complete; they must be addressed before a production pilot. No pagination expansion, automatic source/style analysis, card-drawing engine, embeddings, queue, PDF, delivery, Telegram, billing or multi-reader support. Completed content is immutable; explicit replacement/regeneration and deletion/retention workflows remain separate future work.

36. **Exact changed files.** Listed below, including this report. No package/lockfile, fixture data, existing tests, earlier migrations or original checkout files were changed.

37. **Commit.** The implementation commit hash is supplied in the task's final response and available from git log -1 in this checkout. It is a local commit on the requested branch; no GitHub push or deployment is claimed.

38. **Next milestone.** QUEUE / PRODUCTION ORCHESTRATION, after closing native/browser acceptance gaps. Not started.


- `.env.example`
- `AGENTS.md`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/COST_MODEL.md`
- `docs/EDGE_CASES.md`
- `docs/GENERATION_ENGINE.md`
- `docs/GENERATION_ENGINE_REPORT.md`
- `docs/LOCAL_DEVELOPMENT.md`
- `docs/PRODUCT_SPEC.md`
- `docs/SELLER_STYLE.md`
- `docs/UI_UX_DESIGN_LOCK.md`
- `drizzle/0005_green_mindworm.sql`
- `drizzle/meta/0005_snapshot.json`
- `drizzle/meta/_journal.json`
- `scripts/live-generation-acceptance.ts`
- `src/app/(operations)/orders/[id]/page.tsx`
- `src/app/(operations)/orders/page.tsx`
- `src/components/generation/actions.ts`
- `src/components/generation/prepare-form.tsx`
- `src/components/generation/reading-preparation.tsx`
- `src/components/operations-home.tsx`
- `src/components/seller-status.ts`
- `src/db/schema.ts`
- `src/infrastructure/ai/fake.ts`
- `src/infrastructure/ai/gateway.ts`
- `src/infrastructure/ai/gemini.ts`
- `src/infrastructure/ai/pricing.ts`
- `src/infrastructure/ai/provider.ts`
- `src/infrastructure/ai/runtime.ts`
- `src/modules/generation/context.ts`
- `src/modules/generation/contracts.ts`
- `src/modules/generation/instructions.ts`
- `src/modules/generation/service.ts`
- `src/modules/intake/service.ts`
- `src/modules/seller-style/context.ts`
- `tests/generation.db.test.ts`
- `tests/generation.test.ts`
