# Agent instructions

## Scope and authority

The user authorized Milestone 1 implementation on 2026-10-05: secure read-only Etsy intake and mobile order triage. Use the approved TypeScript/pnpm/Next.js/PostgreSQL/Drizzle/Zod/Auth.js/Vitest stack. No AI SDK/model calls, PDF generation, automated delivery, Redis requirement, or future execution tables in Milestone 1. The current authorized follow-up adds the generic, versioned Product Configuration System described in PRODUCT_CONFIGURATION.md; it still excludes generation, document rendering, delivery, billing and seller style. Live capabilities remain gated by ETSY_INTEGRATION.md. Do not remove that gate based only on fixtures.

User instructions take precedence over this file. Do not assume recommendations are settled decisions. Surface material contradictions and integration limitations instead of inventing API capabilities.

## Required reading

Read README.md and relevant docs/ before changing behavior. Architectural work requires ARCHITECTURE.md; workflow changes require PRODUCT_SPEC.md and EDGE_CASES.md; billable work requires COST_MODEL.md; UI work requires DESIGN_PRINCIPLES.md. Milestone work also requires MILESTONE_1_PLAN.md, ETSY_INTEGRATION.md and MILESTONE_1_REPORT.md. Product changes also require PRODUCT_CONFIGURATION.md and UI_UX_DESIGN_LOCK.md. Inspect more specific AGENTS.md files if introduced.

## Domain and data rules

- Preserve Order -> Line Item -> Fulfillment Unit cardinality. Never attach a single product, generation, or delivery status directly to an order as a substitute for per-unit state.
- Do not bypass module ownership or application services through direct cross-domain table mutations for convenience. Cross-domain orchestration is explicit and transactional where needed.
- Keep marketplace records separate from internal products. SKUs are optional mapping hints, never primary identities.
- Preserve versioned configuration, context, generation history, document revisions, and approval provenance. Do not silently mutate historical inputs.
- Published ProductVersions and bound FulfillmentUnit configuration references are immutable. Editing creates a draft; activation is transactional and cannot silently rebind historical orders. Preserve the migration triggers as well as the Drizzle constraints.
- Keep content structure separate from document appearance. Product-specific tarot concepts must not become mandatory fields of every product.
- Treat external IDs as opaque strings at application boundaries; validate and canonicalize in adapters. Do not risk JavaScript numeric precision loss.

## Security and tenancy

- Authorize every read, mutation, job, download, and external action against organization and store ownership. Do not trust tenant IDs supplied by clients or queue payloads without verifying ownership.
- Use tenant-aware uniqueness and relationships; cross-tenant references must fail. Database isolation defenses supplement application authorization.
- Never commit secrets, tokens, OAuth codes, real customer fixtures, or personal readings. Do not print them in logs, errors, analytics, or screenshots.
- Etsy credentials, model credentials, and signing secrets remain server-side. Encrypt stored credentials using separately managed keys. Keep private documents behind scoped, short-lived access.
- Treat customer text, uploaded files, example readings, and model output as untrusted. Escape rendered content and isolate external resource fetching. Model output never authorizes delivery or selects a tenant.
- Document retention, deletion, provider data handling, and operator access before live customer data is introduced.

## External work and money

- Prefer deterministic parsing, validation, mapping, calculations, template rendering, and workflow decisions. Do not add AI where deterministic code is sufficient.
- Every billable model call must use the generation gateway, durable operation/attempt records, attribution, usage recording, and budget enforcement described in COST_MODEL.md. Tests and retries are not exceptions.
- Disable implicit SDK retries or account for each physical attempt explicitly. Never blindly retry an ambiguous timeout or external delivery.
- Externally triggered workflows and user commands require idempotency, durable state, bounded retries, and concurrency protection. A disabled button is not a correctness guarantee.
- Never promise exactly-once external execution when the provider cannot guarantee it. Preserve unknown outcomes and require reconciliation.
- Do not use scraping, undocumented Etsy endpoints, browser automation, or listing file replacement to bypass unavailable personalized delivery APIs.

## Implementation discipline

- Introduce dependencies only with a written purpose, alternatives considered, maintenance/security/license assessment, and justification in the change description. Follow the chosen lockfile once one exists.
- Keep the initial system modular and small. Do not introduce services, queues, plugin frameworks, vector databases, or package splits without a demonstrated need.
- Preserve phone usability for every operational action. New order handling, correction, preview, regeneration, approval, delivery, and product pause/manage flows must work on a narrow viewport with touch and keyboard access.
- Check integration assumptions against current official Etsy documentation and app access before coding against them. Record verified versus unverified behavior.
- Update the relevant documentation whenever an architectural decision, invariant, capability, or scope changes. Record rationale and consequences; never leave proposed decisions looking finalized by accident.
- Run meaningful checks proportional to the change. For implementation, cover tenant isolation, mixed carts, quantity expansion, duplicate commands, failure recovery, and mobile flows. Use synthetic or properly redacted fixtures.
- Report changes, validation, unresolved assumptions, and material limitations. Never claim a real integration has been tested using only a mock.
