# Etsy Reading OS

Operations software for sellers of personalized digital products on Etsy. The initial market is tarot and psychic reading sellers; the domain must also accommodate astrology, numerology, pet readings, dream interpretation, personalized letters, and other bespoke digital deliverables.

The seller experience centers on orders, product configuration, production, review, and delivery. AI is an internal production capability, not the product's information architecture.

## Current status

Documentation foundation only, dated 2026-10-05. No application, framework, dependency installation, generated boilerplate, or production infrastructure exists. Recommendations below are proposals unless explicitly identified as requirements. No Etsy integration or automated delivery capability has been demonstrated.

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

Start with a modular monolith and one relational source of truth. TypeScript and PostgreSQL are preferred candidates, not final selections. Web/API and worker are runtime roles; domains are modules, not automatically separate services or packages. Do not create empty `apps/` or `packages/` scaffolding before the runtime decisions and first milestone justify them.

## Before implementation

Resolve the decision register in [ARCHITECTURE.md](docs/ARCHITECTURE.md). In particular, verify Etsy application access, personalization payloads, and the permitted mechanism for delivering a unique customer document. Listing-level uploads must not be used as a substitute for order-specific delivery.

Recommended first implementation milestone: a tenant-isolated, read-only Etsy intake and mobile order-triage slice. Its acceptance criteria are in [PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md). It precedes billable production and delivery automation.

Official Etsy assumptions are time-sensitive. Sources and verification dates are recorded in the architecture document; recheck them before implementing adapters.
