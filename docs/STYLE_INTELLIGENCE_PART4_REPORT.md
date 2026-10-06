# Style Intelligence — Part 4 report

Branch: `codex/ui-ux-design-lock`. Starting commit: `b88ef4ba9497f09581f63db7684da777d18e581b`. Branch, HEAD and five recent commits were verified before changes; Part 3 was HEAD. Completed changes use commit message `feat(style): add previous work analysis workflow`; the ending SHA is in the task response.

## Seller workflow and screens

The existing `/settings/profile` extends the established profile/style/library surface with optional Learn my writing style / Update writing style, textual status and a compact read-only preview. Manual settings remain visible and authoritative. The existing previous-work detail route has accurate updated copy; pasted-text create/view/delete flows are reused. No primary navigation, onboarding, product/order screen or generation UI is added or changed.

The `learnWritingStyle` server action derives authenticated Store and owned StyleProfile, rejects client ownership/source/analysis fields, and invokes the existing runtime/execution service. If needed, it creates the stable profile through existing style-draft service. Synchronous pending feedback and a status-only refresh match the actual runtime; there is no queue or fake progress. A retained command key plus durable replay protects repeat submission. New different commands are serialized by the Store lock and refused while earlier execution/accounting remains unresolved.

Seller terms: Previous work, Writing style, Learn my writing style, Update writing style, Not learned yet, Learning your writing style, Style ready, Needs attention. No provider/model/token/cost/job/request terminology, raw infrastructure statuses or visible internal IDs/timestamps are added. Required IDs stay in scoped link/form plumbing only.

## Status, preview and changes

No attempt shows Not learned yet. PENDING/ANALYZING shows Learning your writing style unless an older READY is usable. READY shows Style ready. Failed attempts without READY show Needs attention. Older READY remains visible and usable through learning/failure of later updates, with explanatory product copy.

A short definition list projects Voice, Tone, Structure, Writing tendencies and Preferred patterns, omitting empty groups. Payload is validated; no raw JSON, source snippets, manifest, editable blob or accounting metadata is rendered. Exact tendency limits are documented in STYLE_INTELLIGENCE.md.

Update availability is derived from persisted source/provenance comparison and native SQL creation-time comparison against the READY analysis admission. The current bounded automatic membership is compared to the frozen set. Adding work never invokes analysis. More examples than the oldest-first bounded policy includes are deliberately not advertised as guaranteed different model input; no selection wizard or policy change is introduced.

## Safety and security

`executeForSeller` reuses Part 2 execution, gateway, pricing, accounting and contamination validation. Same-key replay happens before new-request safety checks and never dispatches again. An all-history Store-scoped safety check blocks a new seller request when any version is unfinished, a request is CLAIMED/RUNNING, ambiguity is present or cost remains UNKNOWN. A later completed internal attempt cannot erase earlier unresolved liability. Known terminal settled history can support another explicit version; no automatic retry/fallback exists. Internal APIs retain the original Part 2 explicit-command policy.

Failure copy distinguishes unreliable output from temporary inability and needs-attention states. Budget/platform policy details and raw provider exceptions are hidden. Unresolved history has no new paid action, while any old READY is preserved. No operator recovery implementation or claim of process liveness is added.

Referenced sources remain retained by existing SQL constraints. An owner-locked application precheck returns: “This example is part of your writing style history and can’t be removed yet.” Unreferenced source deletion remains scoped and unchanged. No privacy erasure semantics are invented.

Owner authorization applies to workflow reads and requests; source/profile/version/accounting queries use organization/Store ownership. Same-organization sibling Store tests and forged-field tests pass. Generation admission, context/hash compatibility, pinning, retry and production orchestration files are unchanged.

## Mobile, accessibility and design review

Changed seller files were reviewed against the locked operational ecommerce design: existing label/content sections, compact definition list/status rows, Badge/Button/form/disclosure primitives, neutral tokens, no new decoration/cards/AI branding. Existing single-column 900/600px breakpoints and 44px controls remain; long source headings can shrink and wrap. Manual controls remain accessible, loading is announced, status is textual, errors have alert semantics, and pasted-source errors are associated with title/text inputs. No custom dialogs or hover-only widgets.

Rendered React Settings markup, long Unicode example text, button/status/error semantics and responsive CSS have automated coverage. Browser visual acceptance at narrow widths remains **unverified**: the browser's URL policy rejected the generated local-file preview. No security bypass or alternate browser workaround was attempted. This is not claimed as end-to-end browser acceptance.

## Optional acceptance harness

`scripts/style-analysis-acceptance.ts` is offline by default and uses isolated synthetic-only file-backed PGlite with replayed migrations. Offline execution through the real service/gateway returned READY, validated style-intelligence/v1, one fake dispatch, one SUCCEEDED AIRequest and one settled known-zero UsageEvent. Real dispatch count was zero.

Live mode requires explicit `--live --attempt-id=...`, current configuration selecting gemini-3.5-flash-lite, existing credentials/budgets and an exclusive persistent checkout-local marker. Model overrides are rejected; a repeated attempt ID cannot run again. One network dispatch maximum is asserted. Reporting is bounded state/accounting metadata only; never key, prompt/source text, provider response or sensitive headers. No live invocation was performed. See STYLE_INTELLIGENCE.md for the reviewed commands and marker limitations.

## Validation

| Check | Result |
| --- | --- |
| pnpm typecheck | PASS |
| pnpm test | 122 tests / 18 files PASS |
| pnpm test:db | 256 tests / 11 files PASS |
| pnpm build | PASS, production webpack |
| Unique suite total | 378 tests / 29 files PASS |
| Offline acceptance harness | PASS; 0 real / 1 fake dispatch; READY and settled accounting |
| git diff --check | PASS |

The DB suite includes unchanged Part 3 regressions and existing migration-runner replay/no-op coverage. There is **no schema or migration change**. Eight workflow DB cases and fourteen unit/action/render cases were added. After the full DB suite, final product-copy adjustments were rechecked with the focused workflow DB tests and unit suite. Next build-generated TypeScript configuration changes were restored and typecheck rechecked. The initial tsx CLI harness attempt was blocked from creating an IPC socket; the supported `node --import tsx` invocation ran offline successfully instead.

## Final boundaries and limitations

Part 3 generation semantics remain unchanged. No automatic/recurring analysis, uploads, per-reading analysis selection, raw prompt/intelligence editor, new infrastructure, Review Workspace, PDF, delivery, Telegram, billing, embeddings/RAG/fine-tuning or multi-reader work is included. Real Gemini generation/analysis calls during this task: **0**. Live style quality/structured-output acceptance remains unvalidated. Ambiguous/unmeasured/stuck history needs a separately authorized reconciliation policy; referenced-source retention and bounded oldest-first selection remain limitations. Final git status is reported after commit. Nothing pushed or deployed.
