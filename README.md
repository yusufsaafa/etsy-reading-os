# Etsy Reading OS

Operations software for sellers of personalized digital products on Etsy. The initial market is tarot and psychic reading sellers; the domain must also accommodate astrology, numerology, pet readings, dream interpretation, personalized letters, and other bespoke digital deliverables.

The seller experience centers on orders, product configuration, production, review, and delivery. AI is an internal production capability, not the product's information architecture.

## Current status

Milestone 1 skeleton and transactional intake core, dated 2026-10-05. TypeScript/pnpm/Next.js/PostgreSQL/Drizzle/Zod/Auth.js/Vitest are approved. Synthetic intake is implemented and database-tested; live Etsy intake is deliberately gated pending response-contract validation. No model SDK/calls, PDF engine, delivery automation or Redis is included.

Public entry and authentication now lead into persisted onboarding. Logged-out `/` displays the product landing page; `/sign-up` and `/sign-in` use Auth.js and resume the seller's saved next step. Individual email/password accounts are an explicitly development-only boundary; configured GitHub OAuth remains the supported production identity path. Versioned generic Product Setup is implemented: save drafts, activate configurations and retain historical reading bindings. See [Product configuration](docs/PRODUCT_CONFIGURATION.md). Settings now includes one creator profile, structured draft/published style and a private pasted-text previous-work library. No analysis or generation occurs; file uploads remain deferred because storage currently has a port only. See [seller identity and style](docs/SELLER_STYLE.md) and [validation report](docs/SELLER_STYLE_REPORT.md).

Current entry integration validation: full typecheck, production build, unit/database tests, native PostgreSQL migrations/seed and local browser journey at 1440/768/390px were exercised. See [entry/auth report](docs/ENTRY_AUTH_REPORT.md) for exact results and remaining production limits. This is not a production-ready release.

The seller-facing interface redesign is defined in [UI / UX design lock](docs/UI_UX_DESIGN_LOCK.md): Home, Orders, Products and Settings, with contextual attention queues and independent readings inside each checkout.

See [local development](docs/LOCAL_DEVELOPMENT.md), [implementation plan](docs/MILESTONE_1_PLAN.md), [Etsy capability matrix](docs/ETSY_INTEGRATION.md), and [validation report](docs/MILESTONE_1_REPORT.md).

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

The current milestone is secure read-only intake and mobile triage. Remaining launch gates and the next proposed milestone are in the implementation report. Future production acceptance criteria remain in [PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md).

Official Etsy assumptions are time-sensitive. Sources and verification dates are recorded in the architecture document; recheck them before implementing adapters.
