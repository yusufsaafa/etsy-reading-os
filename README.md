# Etsy Reading OS

Operations software for sellers of personalized digital products on Etsy. The initial market is tarot and psychic reading sellers; the domain must also accommodate astrology, numerology, pet readings, dream interpretation, personalized letters, and other bespoke digital deliverables.

The seller experience centers on orders, product configuration, production, review, and delivery. AI is an internal production capability, not the product's information architecture.

## Current status

Milestone 1 skeleton and transactional intake core, dated 2026-10-05. TypeScript/pnpm/Next.js/PostgreSQL/Drizzle/Zod/Auth.js/Vitest are approved. Synthetic intake is implemented and database-tested; live Etsy intake is deliberately gated pending response-contract validation. The current follow-up implements canonical preparation through a central accounted AI gateway; PDF, delivery automation and Redis are not included.

Public entry and authentication now lead into persisted onboarding. Logged-out `/` displays the product landing page; `/sign-up` and `/sign-in` use Auth.js and resume the seller's saved next step. Individual email/password accounts are an explicitly development-only boundary; configured GitHub OAuth remains the supported production identity path. Versioned generic Product Setup is implemented: save drafts, activate configurations and retain historical reading bindings. See [Product configuration](docs/PRODUCT_CONFIGURATION.md). Settings now includes one creator profile, structured draft/published style and a private pasted-text previous-work library. Explicit bounded style analysis and admission-time generation pinning are implemented; seller analysis controls are available inside Settings. File uploads remain deferred because storage currently has a port only. See [seller identity and style](docs/SELLER_STYLE.md) and [validation report](docs/SELLER_STYLE_REPORT.md).

Current entry integration validation: full typecheck, production build, unit/database tests, native PostgreSQL migrations/seed and local browser journey at 1440/768/390px were exercised. See [entry/auth report](docs/ENTRY_AUTH_REPORT.md) for exact results and remaining production limits. This is not a production-ready release.

The seller-facing interface redesign is defined in [UI / UX design lock](docs/UI_UX_DESIGN_LOCK.md): Home, Orders, Products and Settings, with contextual attention queues and independent readings inside each checkout.

See [local development](docs/LOCAL_DEVELOPMENT.md), [implementation plan](docs/MILESTONE_1_PLAN.md), [Etsy capability matrix](docs/ETSY_INTEGRATION.md), and [validation report](docs/MILESTONE_1_REPORT.md).

Generation architecture, configuration, accounting, limits and acceptance evidence are in [GENERATION_ENGINE.md](docs/GENERATION_ENGINE.md) and [GENERATION_ENGINE_REPORT.md](docs/GENERATION_ENGINE_REPORT.md). The current implementation is backend-tested; native PostgreSQL/browser/live-provider acceptance limitations are explicitly recorded.

## Read first

| Document | Purpose |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Rules for future implementation agents |
| [Product specification](docs/PRODUCT_SPEC.md) | Scope, workflows, acceptance criteria, unresolved product decisions |
| [Architecture](docs/ARCHITECTURE.md) | Domain model, boundaries, invariants, security, technology decisions |
| [Design principles](docs/DESIGN_PRINCIPLES.md) | Desktop configuration and mobile operations requirements |
| [Edge cases](docs/EDGE_CASES.md) | V1 architecture commitments and deferred workflows |
| [Cost model](docs/COST_MODEL.md) | Attribution, budgets, duplicate prevention, and pricing semantics |

## Non-negotiable foundations

- One order has multiple line items. Each purchased quantity becomes an independent fulfillment unit, with its own production history, documents, approval, and delivery allocation.
- Content templates and document templates are separate, versioned concepts.
- Published product configuration and customer context are snapshotted for production; later edits never silently change existing work.
- Every billable external model operation goes through a controlled gateway and is observable and attributable, including retries, failures, and tests.
- Tenant isolation, durable background work, idempotency, private artifacts, and phone usability are V1 requirements.
- Seller review is the initial delivery gate. Unattended delivery is future work and depends on verified channel capability and product policy.

## Proposed engineering direction

The implementation uses one Next.js application, domain modules under src/modules, infrastructure ports/adapters under src/infrastructure, and a PostgreSQL schema under src/db. The worker is a script using the same modules. No unused apps/packages scaffolding exists. Secret storage and private object storage have provider-neutral boundaries; sync jobs use PostgreSQL behind BackgroundJobs.

## Before implementation

Keep the recorded local acceptance checks passing. For live Etsy, obtain approved app access and validate authorized listing/receipt fixtures before enabling the live intake adapter. Listing-level uploads must not be used as a substitute for order-specific delivery.

Canonical generation with centralized accounting and bounded Production Orchestration Parts 1–4 are complete. Secure read-only intake and mobile triage remain intact. Native/browser/live-provider acceptance limits and the next recommended milestone are in GENERATION_ENGINE_REPORT.md. Future production acceptance criteria remain in [PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md).

Official Etsy assumptions are time-sensitive. Sources and verification dates are recorded in the architecture document; recheck them before implementing adapters.

## Production orchestration — Part 1

Version-owned Manual/Assisted production and Standard/Express fulfillment targets now support durable automatic admission of eligible ASSISTED readings. At the Part 1 boundary waiting work did not execute; Parts 2–4 below complete its bounded production pipeline. See [architecture](docs/PRODUCTION_ORCHESTRATION.md) and [Part 1 report](docs/PRODUCTION_ORCHESTRATION_REPORT.md). Existing manual preparation remains available.

## Production orchestration — complete (Parts 1–4)

Durable waiting readings can now be scheduled and claimed using deadline/Express/aging rules, persistent Store fairness and bounded claim cycles. Stale work is retained as skipped; safe unexecuted expired claims can be reclaimed. Explicit trusted server cycles now execute fenced claims through existing GenerationService, with stable command identity, canonical/accounting persistence and token-fenced settlement. Ambiguous execution is never automatically retried; no recurring worker is installed. Known safe failures now use durable linked retries/backoff; bounded reconciliation adopts existing success and quarantines unknown execution. `productionRuntime(db).runProductionTick()` coordinates reconciliation then sequential bounded execution across ordinary overlapping calls. A recurring external deployment trigger remains required. See the Part 4 sections in [architecture](docs/PRODUCTION_ORCHESTRATION.md) and [report](docs/PRODUCTION_ORCHESTRATION_REPORT.md).


Generation model default: `gemini-3.5-flash-lite`. Both `gemini-3.5-flash-lite` and `gemini-3.8-flash` remain explicitly priced/supported. `AI_GENERATION_MODEL` overrides the default; no automatic fallback exists. Flash Lite passed controlled real synthetic acceptance; two historical 3.8 requests received HTTP503/UNAVAILABLE/high demand. See docs/GENERATION_ENGINE.md and docs/GEMINI_ACCEPTANCE_REPORT.md.

Style Intelligence Part 1 now provides strict bounded writing DNA contracts, immutable independently numbered analysis versions and exact frozen source provenance on the existing StyleProfile. Part 1 established persistence; execution and generation consumption are documented in the Parts 2–3 follow-ups below. Seller controls remain deferred. See [Style Intelligence](docs/STYLE_INTELLIGENCE.md).

Style Intelligence Part 2 now executes explicitly bounded previous-work analysis through CentralAIGateway with structured validation, contamination/verbatim guards, durable command replay and the existing usage/cost ledger. There is no real-provider acceptance claim for analysis. At the Part 2 boundary generation did not consume the result; Part 3 below adds pinning. Seller UI remains unchanged. See [Style Intelligence](docs/STYLE_INTELLIGENCE.md).

Style Intelligence Part 3 now pins the latest usable owned READY analysis into each new Generation context. Explicit seller style settings take precedence; retries and historical contexts retain their original snapshot/hash. Historical source text and manifests never enter customer generation. At the Part 3 boundary seller workflow/UI remained deferred; Part 4 below completes it. See [Style Intelligence](docs/STYLE_INTELLIGENCE.md).

Style Intelligence Part 4 completes the optional Settings workflow: Previous work → Learn/Update writing style → compact status and preview. New commands are blocked while analysis execution/accounting is unresolved; current READY style remains usable after failed updates. No automatic analysis or navigation/onboarding requirement is added. The synthetic one-shot acceptance harness is offline by default; live style acceptance remains unexecuted. See [Style Intelligence](docs/STYLE_INTELLIGENCE.md).
