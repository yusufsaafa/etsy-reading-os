# Pilot and production acceptance ledger

This ledger tracks work deliberately deferred from implementation. A passing fake-provider/PGlite test does not close a real-provider, real-Etsy, real-storage or native multi-connection acceptance item. No item below was executed by Part 2.5B. Historical acceptance attempt IDs must never be reused. Part 2.5B initially left all rows OPEN. The subsequent controlled tarot acceptance below closes only GEMINI-TAROT-01; every other row remains OPEN.

| ID | Classification | Acceptance debt / completion evidence | Status |
| --- | --- | --- | --- |
| MEDIA-NATIVE-01 | BLOCKS MRH PILOT (closed) | ACCEPTED 2026-10-07 on local native PostgreSQL 16.14 with independent connections, observed Store/version lock contention, preference/publication/retirement/design/approval races, duplicate artifacts, distinct-backend expired/late claim fencing and crash/finalization/ambiguous-write recovery. Three final 82-test runs passed; seven synchronized families × 15 iterations each. See MEDIA_NATIVE_ACCEPTANCE_REPORT.md. No universal deadlock or real storage claim. | ACCEPTED |
| ETSY-E2E-01 | BLOCKS MRH PILOT | Authorized real Store paid-order event → OAuth/API receipt fetch → intake → Product mapping → individual FulfillmentUnit/Reading → production. Validate supported `order.paid` webhook/event contract, subscription/access/signature and replay behavior; the desired chain is not a claim that any unverified webhook capability is available. Preserve ETSY_INTEGRATION.md live gate until evidence exists. | OPEN |
| ETSY-CARDINALITY-01 | BLOCKS MRH PILOT | Real authorized/redacted payloads: duplicate/replay/out-of-order events, mixed carts, quantity allocation and stable unit expansion. Evidence must show no duplicated or rebound readings and correct holds. | OPEN |
| PDF-REAL-01 | BLOCKS MRH PILOT | Before a PDF pilot, after Parts 3/4: intended runtime/host and representative actual approved Readings; actual approved assets once TAROT-ASSETS-01 permits them; final visual inspection, long content/pagination, Unicode capability/failure behavior, deterministic output, production memory/concurrency and codec behavior; exact font/shaping equivalence and shared preview/PDF page/line parity once preview exists; intended artifact/storage workflow. Part 3B-2 implements rendering and synthetic glyph/raster checks, not this real acceptance. A separately scoped text-only pilot does not imply PDF acceptance. | OPEN |
| TAROT-ASSETS-01 | BLOCKS MRH PILOT | Before enabling card visuals: operator-verified commercial SaaS/PDF rights and evidence for actual artwork; complete exact 78-card mapping; decoded MIME/dimensions; SHA-256/length integrity; immutable storage keys, retention and availability. Synthetic fixtures are not approved real artwork. A text-only pilot does not imply visual acceptance. | OPEN |
| GEMINI-TAROT-01 | BLOCKS MRH PILOT | Accepted single controlled synthetic TAROT_CARDS Generation on 2026-10-07 at f11717ccf06eafd0eee24e2467cf294d6eb75d2a, google / gemini-3.5-flash-lite. Three cards; one dispatch; canonical validation and accounting passed. Evidence below. | ACCEPTED |
| ETSY-DELIVERY-01 | BLOCKS PRODUCTION LAUNCH | During Delivery milestone, re-check CURRENT official Etsy API capabilities and app access, especially personalized PDFs/messages through conversations. Document verified support versus unavailable capability; do not assume automated delivery or use listing-file replacement as a substitute. No delivery integration is authorized by this ledger. | OPEN |
| AI-CONFIG-01 | BLOCKS PRODUCTION LAUNCH | Final production-configuration smoke for the previously accepted real Gemini Generation and Style Analysis paths: correct model, credentials, limits, command/attempt identity and canonical/accounting outcomes. Fresh unique acceptance attempt IDs; historical acceptance is evidence for its configuration only. Do not automatically dispatch from normal tests/builds. | OPEN |
| STORAGE-REAL-01 | BLOCKS PRODUCTION LAUNCH | Implement and verify the intended S3-compatible trusted adapter: exact object reads, access policy, write-once keys, digest/length failure, retention/recovery and approved asset availability. PlatformAssetStorage is currently only a port. | OPEN |
| REVIEW-CARDS-UI-01 | NON-BLOCKING FOLLOW-UP | Final frontend pass: show the pinned semantic cards during review/approval, preserve bodies-only editing and communicate approval scope. Backend exposes frozen card evidence now; current UI does not yet display it. Reclassify as a blocker if pilot sellers approve tarot readings through that UI. | OPEN |

Closing an item requires dated evidence, configuration/commit, environment, exact synthetic/redacted scope, result and reviewer. Classification is relative to the stated pilot capability: card visuals/PDF cannot borrow acceptance from a text-only flow. Do not execute unrelated ledger items during implementation without their own authorized task.

## GEMINI-TAROT-01 — accepted 2026-10-07

Evidence reviewed by Codex against the unchanged production validator and gateway accounting. User explicitly authorized this one bounded real acceptance; no other ledger item was executed or closed. Environment: recovered local macOS checkout, Node 22.23.1, isolated file-backed synthetic PGlite database, no production DATABASE_URL use. Configuration commit: `f11717ccf06eafd0eee24e2467cf294d6eb75d2a`. Provider `google`, configured and resolved model `gemini-3.5-flash-lite`; model was not changed. Synthetic Store, reader, ProductVersion, order and Jane Test customer only. Requirement TAROT_CARDS, cardCount 3.

Fresh attempt `tarot-20261007-f31270bb7774477a`; commandKey `1f06ed69-80b6-4cf9-9e58-15d075ed1ca0`; Generation `840503a3-105b-4594-94de-a89984f00fb4`; AIRequest `f9a1262d-c8e8-4194-8d0d-646b9090628c`; provider response ID `4B_Garb3DcbW7M8P9faryQ4`. Dispatch started 2026-10-07T10:32:55.836Z and settled 10:33:06.633Z. HTTP 200; Generation SUCCEEDED; AIRequest SUCCEEDED; canonicalValidated true; ambiguous false. Exactly one physical transport invocation, one AIRequest and one UsageEvent; retries/fallback/second dispatch = 0.

| Position | Canonical cardKey | Orientation |
| --- | --- | --- |
| 0 | TWO_OF_CUPS | UPRIGHT |
| 1 | PAGE_OF_WANDS | UPRIGHT |
| 2 | THE_STAR | UPRIGHT |

Unmodified `validateCanonical` revalidated the persisted result against the admitted context and matched it exactly. Three distinct catalog keys, legal orientations, distinct consecutive zero-based positions equal array order; no extra card fields, deck/version/asset/URL/storage/artwork contamination. All three configured text sections passed exact section identity/title/count and bounded content validation: current-feelings / Current Feelings (503 characters), their-intentions / Their Intentions (489), relationship-direction / Relationship Direction (486). This proves this request's structural compatibility, not broad quality or future provider reliability.

Accounting: input 1,073 tokens; output 511 tokens; total 1,584; cached 0. Existing pricing version `google-standard-flash-lite-2026-10-06`: 300 input and 2,500 output USD nanos/token. Settled estimated amount 1,599,400 USD nanos = **$0.0015994**. CostState estimated; one UsageEvent (`e58f7ea7-a663-4e74-af45-98cb0aeced9f`) linked to the AIRequest; amount equals the gateway request estimate and independent existing calculateCost result. UsageEvent creation 10:32:55.816Z preceded dispatch. This is an accounting estimate, not an invoice claim.

Harness: reused `scripts/synthetic-gemini-acceptance.ts` in a temporary copy, adding only the isolated synthetic three-card configuration, exact tarot schema bytes to preflight reservation, assertion of the unchanged intended model and bounded configured budgets ($0.05 attempt/$0.10 isolated daily; 8,192 output token cap). Zero-network preflight passed admission/budget checks with no requests. Live command was `node --env-file=.env.local --import tsx scripts/temporary-tarot-acceptance.ts --live --attempt-id tarot-20261007-f31270bb7774477a`. Existing runtime → GenerationService → CentralAIGateway → Gemini performed the request. Exclusive durable one-shot marker and second-fetch assertion prohibited another invocation. No provider/client/gateway/product/review code or persistent configuration changed. Temporary harness was removed after evidence capture; no secret, env file or database is committed.

Retained local synthetic evidence: `/var/folders/kl/j2ydy6n901z5k8j0l4xn5tt00000gn/T/reading-os-synthetic-gemini-N2zXpS/acceptance-result.json`; SHA-256 `9a6021555a6fefc4f87c87d4e4a08044034fdae4f77ca2267003b5a06faad6c0`. Temporary harness SHA-256 `5aa692e3a23a44dab2a13e3e1b8030a00b5fd19cdce039f89b4c8c6c2d8ab492`. One-shot marker and synthetic database remain retained locally; do not reuse the attempt ID. Documentation validation: `git diff --check` PASS. No push/deployment. All nine independent debts remain OPEN, including native PostgreSQL concurrency, real artwork/storage, PDF, Etsy and production AI-config acceptance.

## Part 3B-1 implementation prerequisites — not acceptance closure

2026-10-07: official Inter v4.1 and Adobe Source Serif 4.005R static TTF packages and upstream OFL-1.1 evidence are retained locally; production-font-metrics/1 uses verified bytes and Fontkit 2.0.4 for the bounded Latin/Turkish LTR capability. Trusted resource preparation verifies frozen assets and fully decodes synthetic raster fixtures. This closes no acceptance row and does not change GEMINI-TAROT-01 evidence.

PDF-REAL-01 must still verify actual embedding/rendering of those exact font bytes, supported kerning/ligature/combining-mark glyph positioning, long-content pagination, multilingual capability/error policy, shared preview/PDF page/line parity, image transforms/decoration, deterministic PDF metadata/output and rendering failures after Part 3B-2/4. Include the intended deployment's Sharp/libvips codec behavior and resource-memory/concurrency limits in that acceptance; synthetic local decode is not production-host acceptance.

TAROT-ASSETS-01 still requires approved real commercial artwork/evidence, exact 78-card mapping, actual MIME/dimensions/digests and immutable availability. STORAGE-REAL-01 still requires the real intended S3 adapter, including enforcement of maxBytes during reads, access/write-once/retention/recovery and failure behavior. MEDIA-NATIVE-01 and every independent Etsy/AI configuration/Review UI debt stay OPEN.

## Part 3B-2 implementation prerequisites — not real acceptance

2026-10-07, base dfbeea7248f354e597aa5e694566b4eebc289716: reading-pdf/1 with pdf-lib 1.17.1 embeds exact normal/400 Inter/Source Serif TTFs and paints production-font-metrics/1 glyphs at authoritative layout positions. Synthetic PNG/JPEG/WebP artwork, reversed transforms, long sections, footer, Latin/Turkish, deterministic metadata/bytes and six templates are implemented/tested. Independent local PyMuPDF 1.26.7 reopened/rasterized six deterministic synthetic PDFs (35 pages), matched every original glyph ID/origin and checked repeated pixels/reversal markers. Representative page PNGs were visually inspected locally. This is implementation/regression evidence, not intended-host or actual-Reading/artwork acceptance.

PDF-REAL-01 remains OPEN: obtain real intended-host visual/long-content/font/image/error/memory/codec/output evidence, representative approved payloads and legally approved actual tarot assets; prove preview/PDF parity when preview exists and validate the Part 4 artifact/storage path. TAROT-ASSETS-01 and STORAGE-REAL-01 remain OPEN with unchanged independent criteria. GEMINI-TAROT-01 remains ACCEPTED with its evidence untouched; all other row statuses are unchanged. No live AI, Etsy, storage or real-artwork acceptance was executed.

## Part 4 implementation prerequisites — no real acceptance closure

2026-10-07, base cdc509b1c709b5e565d34590c7d44ec07087f238: owned immutable PDF artifacts, pending-before-write recovery, write-once/bounded-read storage port, integrity-verified retrieval and downstream PostgreSQL production are implemented. The adapter is test memory storage only; productionRuntime requires server-injected document ports and otherwise reports STORAGE_NOT_CONFIGURED. GEMINI-TAROT-01 remains ACCEPTED; all other nine statuses remain OPEN. No actual environment acceptance was executed.

- **PDF-REAL-01 / OPEN — BLOCKS MRH PILOT:** intended host/runtime, representative actual approved Readings, permitted actual artwork when applicable, actual artifact/storage path; final visual/long-content/Unicode/error/determinism evidence; memory/concurrency/Sharp codec behavior; eventual shared preview/PDF parity. Internal artifact persistence/retrieval is now implemented, not real accepted.
- **TAROT-ASSETS-01 / OPEN — BLOCKS MRH PILOT:** actual commercial SaaS/PDF rights/evidence, complete exact 78-card mapping, real MIME/dimensions/SHA/length and immutable availability/retention. Synthetic rectangles do not close this.
- **STORAGE-REAL-01 / OPEN — BLOCKS PRODUCTION LAUNCH:** intended private S3-compatible asset/artifact adapter; real atomic conditional writes under contention; identical replay/different-byte or MIME conflict; ambiguous successful writes/pending adoption; bounded reads/key/MIME/length/SHA; tenant access policy, retention/no destructive overwrite and recovery/availability. Optional future private distribution does not replace this evidence. Port/fake tests are not acceptance.
- **MEDIA-NATIVE-01 / OPEN — BLOCKS MRH PILOT:** extend native PostgreSQL separate-connection evidence to Store→work/artifact locks, duplicate approval/admission/render intents/finalization, concurrent and expired/late workers, crashes around writes/finalization, holds versus input pinning, explicit recovery and historical retrieval. PGlite cannot prove native lock timing/deadlock freedom.

ETSY-E2E-01 and ETSY-CARDINALITY-01 remain OPEN with their existing authorized real-intake/cardinality/replay criteria. ETSY-DELIVERY-01, AI-CONFIG-01 and REVIEW-CARDS-UI-01 retain existing independent classifications/criteria. No live gate is removed.

### Roadmap: backend acceptance is not seller pilot

1. **MRH backend real acceptance:** MEDIA-NATIVE-01; authorized real Etsy intake/E2E; real cardinality/replay; backend PDF host/artifact acceptance; permitted actual tarot asset acceptance. STORAGE-REAL-01 remains separately controlled and blocks production launch.
2. **Final seller UI:** Connect Etsy, Products, Style setup, Orders, Review/Approve, Document Design, PDF ready/download and operational mobile behavior. Current Part 4 backend does not complete this UI.
3. **MRH seller pilot:** actual seller UI, authorized real Store/products/orders, review/approval/artifact production and initially manual Etsy delivery. Backend test completion alone does not authorize or prove this pilot.
4. Delivery.
5. Telegram operations.
6. Billing.
7. Production hardening.

No later stage or real external acceptance starts automatically during Part 4.

## Native PostgreSQL acceptance — 2026-10-07

MEDIA-NATIVE-01 is now ACCEPTED, superseding its historical OPEN references above. [Native evidence](MEDIA_NATIVE_ACCEPTANCE_REPORT.md) records PostgreSQL 16.14, disposable local databases, separate backend PIDs, actual lock waiters, three unchanged 82-test runs and explicit limitations. Production implementation/schema were unchanged; test memory storage accepts only DB protocol recovery, not STORAGE-REAL-01.

All other statuses remain unchanged. Remaining MRH backend blockers: ETSY-E2E-01, ETSY-CARDINALITY-01, PDF-REAL-01 and TAROT-ASSETS-01. STORAGE-REAL-01/ETSY-DELIVERY-01/AI-CONFIG-01 remain OPEN production-launch debts; REVIEW-CARDS-UI-01 remains OPEN; GEMINI-TAROT-01 remains ACCEPTED. Next is controlled MRH backend real acceptance, then Final Seller UI, then MRH Seller Pilot. Native backend acceptance does not establish seller UI readiness.

## Etsy real acceptance preflight — 2026-10-07

ETSY-E2E-01 and ETSY-CARDINALITY-01 remain **OPEN — BLOCKS MRH PILOT**. [Blocked acceptance audit](ETSY_REAL_ACCEPTANCE_REPORT.md): current official docs confirm order.paid webhooks, PKCE/read scopes and multi-answer personalization. Local configuration has no Etsy app credentials/registered callback, live OAuth disabled and only one disconnected fixture Store without tokens/shop identity. No real receipt was fetched. The live adapter and non-fixture sync admission remain deliberately gated; there is no webhook receiver. Owner authorization and verified raw receipt normalization are implementation/acceptance prerequisites. Synthetic regression passed 9 unit + 12 DB tests; it closes neither debt. All other statuses unchanged.
