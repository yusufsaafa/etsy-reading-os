# Milestone 1 implementation and validation report

Date: 2026-10-05. Status: implemented skeleton and tested intake core; application runtime acceptance is incomplete because Auth.js cannot be installed in the current network-restricted environment. This is not a production-ready release or a verified live Etsy integration.

## Implemented

One Next.js modular monolith with responsive operational screens, TypeScript/Zod canonical contracts, PostgreSQL/Drizzle schema and migration, tenant authorization, receipt-atomic imports, stable quantity expansion, immutable purchase snapshots, versioned seller corrections, explicit variant mappings, and derived Needs Attention. PostgreSQL sync runs implement a replaceable background-job port. SecretVault has a local AES-256-GCM implementation; PrivateObjectStorage is a port with no unnecessary implementation.

No AI SDK, model requests, PDF engine, delivery calls, Redis or speculative future-generation tables. No webhook endpoint is exposed; manual/poll-style synchronization is the initial intake mechanism.

## Dependencies and justification

| Dependency | Purpose / alternative decision |
| --- | --- |
| TypeScript | Approved language, compile-time contracts |
| Next.js + React/React DOM | Approved responsive app/runtime; route handlers and server actions avoid a second server framework |
| Drizzle ORM + drizzle-kit | Approved typed relational schema and reviewed migrations rather than a separate generic repository framework |
| postgres | Small PostgreSQL driver for Drizzle; no extra connection-pool package |
| Zod | Approved validation at untrusted input and adapter boundaries |
| Auth.js (next-auth) | Approved session/login implementation; no custom authentication replacement; pinned v5 beta needs release review |
| Vitest | Approved behavior tests |
| tsx | Runs migration/seed/worker TypeScript without another runtime framework |
| @types/node/react/react-dom | Type definitions only |
| @electric-sql/pglite (development only) | Runs real PostgreSQL engine/migration behavior without unavailable native shared memory or a separate test server; never the production application database |

Vite and @emnapi/core transitive versions are pinned through pnpm overrides to available compatible cache versions. No SaaS starter kit, styling framework, icon suite, cloud SDK or queue broker was added. Selected direct libraries use permissive upstream licenses; dependency maintenance/security scanning of a complete installed tree remains a deployment gate. Native modules and Auth.js beta compatibility must pass a full install/build before approval.

## Database

14 tables: app_users, organizations, memberships, stores, etsy_connections, listings, listing_mappings, orders, order_line_items, fulfillment_units, customer_inputs, oauth_states, sync_runs, audit_logs.

All store-owned associations use composite organization/store foreign keys. Uniqueness covers memberships, external shop identity, listing/variant mapping, external receipt/transaction identity, per-line unit index, context revisions, OAuth state hashes and sync command keys. A partial unique index permits one queued/running sync per store. Positive quantities/unit indexes and role/status checks are enforced by PostgreSQL.

Receipt transactions roll back all order/line/unit writes on a partial failure. Completed receipts survive an interrupted sync and are safely replayed. Store row locks serialize imports and sensitive connection mutations. Purchased source data is retained; later source drift creates a hold rather than renumbering units. Seller corrections remain separate and survive imports. JSONB comparisons use canonical key ordering to avoid false drift on replay.

## Routes and operational behavior

| Route | Purpose |
| --- | --- |
| /sign-in | Auth.js application login; guarded fixture-development login or GitHub |
| /onboarding | Authorized workspace creation |
| / | Operational dashboard |
| /orders | Checkout list with per-unit aggregate issues |
| /orders/[id] | Purchased facts, individual units, correction/allocation controls |
| /needs-attention | Unit issue queue and link to connection/sync health |
| /products | Source listings, explicit variant intake mapping and pause/resume |
| /store | Consent explanation, connection status, sync runs and local disconnect |
| /api/auth/[...nextauth] | Auth.js login/session handlers |
| /api/etsy/callback | Server-only OAuth completion; safe redirect notice |

Reusable UI establishes typography, spacing, buttons, fields, cards, badges, navigation, loading, errors and empty states. Layout adapts to narrow screens, uses readable stacked items and 44px+ primary targets, and contains no generic AI visual patterns. Browser/touch validation is still unverified.

## Etsy verification and limits

ETSY_INTEGRATION.md records official OAuth/PKCE/refresh, read endpoint and personalization evidence, plus source dates. Scopes are listings_r and transactions_r; no write scope is requested. Webhook documentation was reviewed but subscription/delivery is not implemented. Automated personalized delivery and programmatic remote revocation are not assumed.

The live intake port fails explicitly pending authorized response-contract tests. OAuth/refresh/shop lookup are implemented against documented flows, with mocked boundary tests; actual Etsy authorization, expiry/rotation, app access approval and revoked-token behavior were not exercised. Remote revocation is a manual seller action after local credential deletion. Fixture mode never pretends to be a live shop connection.

## Security controls

Membership authorization derives scope server-side; IDs from forms are validated and looked up within the authorized tenant/store. Composite foreign keys reject cross-tenant children. Worker scheduling performs a narrowly scoped internal queue scan and then reauthorizes the initiating actor for each tenant's work. Credential columns are excluded from browser-facing status queries and sessions.

OAuth state is random, hash-stored, user/store-bound, expiring and single-use; verifier is encrypted and erased on consumption/disconnect. Connection epochs fence old work/callbacks. Refresh has a persistent single-claim guard; ambiguous outcomes hold for reconnect. Disconnect deletes tokens, invalidates intents and cancels queued/running syncs. AES-GCM binds secrets to tenant/store context with an external key; production KMS/key rotation remains open.

Auth.js handles login CSRF/session mechanics; Next.js protects server-action origins. Customer corrections and security-sensitive connection/sync/mapping actions are audited without raw customer content or credentials. Outputs are escaped by React; upload URLs are not fetched. Production credentials cannot use the local fixture login. External token errors/logging are reduced to safe codes.

## Validation

Core TypeScript compilation passed. Vitest: 15 domain/security tests passed; 12 PostgreSQL-engine tests passed (27 total). Tests cover mixed carts, quantity three, replay, transaction rollback/retry, tenant denial/forged scope, composite foreign keys, absent personalization, unknown variants, Unicode, preserved corrections, stale revisions, cancellation ordering, drift, duplicate sync requests, partial sync retry, disconnect fencing and OAuth state/secret handling.

Full typecheck and Next.js production build were attempted and blocked by missing next-auth; no substitute/stub was used. Auth.js and its dependencies are absent from the available package cache and registry DNS is unavailable. A partial installation lockfile is not checked in. No live Etsy session, full browser session or native PostgreSQL concurrent-worker test was claimed.

This fixture skeleton reads store datasets for its operational projections without UI pagination. Mapping requirements are derived from imported listing questions; a configurable input-schema editor and richer drift resolution are future work. Source changes are held conservatively; purchase facts are never rewritten to make them appear resolved. Production readiness additionally requires pagination, a native database smoke test, complete lockfile/license/advisory review, login abuse controls and deployment verification.

## Remaining gates and next work

1. Complete package installation on a registry-connected machine; generate/commit the complete pnpm lockfile; pass full typecheck/build.
2. Run the fixture demo against native PostgreSQL and test phone/desktop workflows, concurrent sync workers and login/session controls.
3. Obtain approved Etsy access and record redacted authorized response fixtures; implement/enable the live read adapter, pagination/reconciliation and rate-limit handling with those contracts. Verify revoked authorization and remote disconnect instructions.
4. Define production authentication/abuse controls, privacy retention/deletion, key management/rotation, backup/restore, and deployment monitoring before real customer data.

Do not add billable production before the above Milestone 1 acceptance gates. After acceptance, the next product milestone can add one versioned production recipe with separate content/document templates, controlled cost-observable generation, review and a verified/manual delivery channel. That work requires separate authorization and provider decisions.
