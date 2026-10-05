# Milestone 1 implementation plan

Approved stack (2026-10-05): TypeScript, pnpm, Next.js App Router, PostgreSQL, Drizzle, Zod, Auth.js, Vitest. One modular monolith and responsive web UI. No AI SDK/calls, PDF engine, delivery, Redis, or cloud object-store dependency.

The previous documentation-only phase is superseded by the user's implementation authorization. The full V1 production design remains future scope; its AI/document tables must not be created in this milestone.

## Structure

- src/app: pages, Auth.js handlers, Etsy callback, protected server actions.
- src/components: restrained reusable typography, forms, navigation, cards/status/empty/error/loading components.
- src/modules/identity: users, membership and authorized store scope.
- src/modules/intake: canonical Zod input contract, deterministic validation, order/line/unit ingestion, triage services.
- src/modules/etsy: adapter contracts, fixtures, verified HTTP/OAuth boundary.
- src/infrastructure: encrypted secret vault, PostgreSQL sync job adapter, provider-neutral object-storage port.
- src/db: Drizzle schema, connection and transaction repository; drizzle/: generated migrations.
- scripts: local seed, migrations, worker; tests/: domain/security/PostgreSQL checks.

No apps/packages workspace split until multiple deployables or actual package reuse justify it. Worker is an execution entry point using the same modules.

## Database approach

PostgreSQL is the only durable source of truth. Drizzle owns typed schema/migrations; postgres.js is the minimal driver. Tenant/store composite foreign keys prevent cross-tenant associations. Unique external shop, receipt, transaction and unit-index keys enforce replay safety. Intake commits one full receipt plus all lines/units in a transaction, checkpointing per receipt. Sync runs provide command deduplication and one active job per store; claims/retries use row locks and leases behind a job interface. No check-then-insert correctness dependency.

Local demonstration uses PostgreSQL plus synthetic Etsy fixtures, not a hidden SQLite/in-memory production fallback. Auth.js development credentials are explicitly enabled only outside production; production uses an application OAuth provider. Application login is separate from Etsy authorization.

## Stages

1. Verify/document Etsy capabilities and unresolved assumptions before integration code.
2. Create the small dependency/runtime foundation, domain schema and migrations; implement transactional intake/authorization and synthetic adapters.
3. Add application authentication, secure Etsy OAuth/secret boundary, disconnect and replaceable sync job/storage ports.
4. Build responsive dashboard/orders/detail/attention/listings/store and shared UI. Expose honest development versus live capability status.
5. Validate required behavior with Vitest and real PostgreSQL where available; run type/build/UI checks; update run guide and limitations.

## Deliberate limits

One-owner/store onboarding first. Mapping records define input requirements, not generation recipes. Quantity allocation is held until seller confirmation. Input corrections remain auditable and survive replay. Unsupported attachment personalization is held without fetching it. No paid processing of historical imports. Remote revocation, broad commercial access and live response compatibility must be independently verified, never simulated as live success.
