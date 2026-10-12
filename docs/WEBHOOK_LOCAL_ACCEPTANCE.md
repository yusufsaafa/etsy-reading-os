# Controlled local webhook acceptance runner

Preparation only. No PostgreSQL connection, acceptance write or worker execution
was performed by Codex. Native DB and browser acceptance remain PENDING.
Branch: `codex/ui-ux-design-lock`; base: `034c111bddd9f0ff870f5a7b54118a1143a403cb`.
All existing uncommitted work is preserved.

Use Node >=22.12, installed pnpm dependencies, and the repository directory.
The runner never loads an env file itself. The commands below explicitly preload
`.env.webhook-test.local`; it must contain the exact disposable DATABASE_URL.
No fallback to `.env.local`, migrations, reset, cleanup or automatic setup exists.

First stop all background workers in your terminal/process manager. A running
web application may stay open. Disabled environment flags cannot prove that an
independently launched process has stopped; do not run acceptance concurrently
with other intake/production workers. The runner refuses enabled worker flags.

## Required product setup

Choose the actual Store UUID and two distinct existing Product UUIDs for Love
and Career. Both must belong to that store and have an ACTIVE version with an
Etsy READING policy, an exact unpaused listing/purchase-selection mapping and
mapped required text inputs. Each selection currently requires one value ID.
The runner reads these identities at runtime; it does not alter product setup.
Missing prerequisites abort with a safe error code. Product IDs can be obtained
from their `/products/<id>` application pages. Obtain the store ID from existing
local administration/SELECT queries; it is not a shop ID.

## Read-only preflight — run this first

From the repository root, substitute the UUID placeholders:

```sh
node --env-file=.env.webhook-test.local --import tsx scripts/acceptance/webhook/local-runner.ts preflight --store-id STORE_UUID --love-product-id LOVE_PRODUCT_UUID --career-product-id CAREER_PRODUCT_UUID
```

Preflight uses server-enforced default read-only transactions. It validates:

- Explicit postgres URL with exact host `127.0.0.1`, port `5432`, user
  `yusufsafakilic`, database `etsy_reading_os_webhook_test`; query parameters and
  fragments are rejected to prevent connection-target overrides.
- Live `current_database`, `current_user`, server address and port.
- Every current repository Drizzle migration hash already present in the DB.
- Connected Etsy store, transaction scope, OAuth initialization and current epoch,
  and owner authorization for the OAuth actor.
- Exact ACTIVE mappings, fixture assessment and version resolution.
- Receipt/transaction collisions across the entire disposable DB.

Only counts/IDs, expected outcomes and safe error codes are printed. No tokens,
signing secret, raw fixture/customer data or connection URLs are logged.

## Database-writing acceptance — NOT executed in this preparation task

After reviewing preflight and explicitly authorizing execution:

```sh
node --env-file=.env.webhook-test.local --import tsx scripts/acceptance/webhook/local-runner.ts run --store-id STORE_UUID --love-product-id LOVE_PRODUCT_UUID --career-product-id CAREER_PRODUCT_UUID --confirm-disposable-db-write
```

Without confirmation it aborts before connecting. The command reruns preflight
and live identity checks. Writes execute within one transaction; an invariant
failure rolls back the complete run. Concurrent runner instances serialize using
an advisory transaction lock. Success commits the synthetic order for UI review.
A second fresh run fails the collision check, rather than overwriting old data.

The dedicated random signing key is generated in memory and never taken from
`ETSY_WEBHOOK_SIGNING_SECRET`. The normal HTTP handler authenticates a non-test
`order.paid` event with exact bound shop ID and a canonical `api.etsy.com` receipt
URL. The same signed message is delivered twice to check inbox deduplication.
The selected-event worker filter includes inbox UUID, message ID, tenant, store,
shop and epoch. Only that event can be claimed. A receipt dependency supplies
repository-contract synthetic bytes; global fetch dispatch is disabled.

Fixture provenance: `tests/fixtures/etsy-raw.ts`, adapted at runtime to the two
chosen policies. This is SYNTHETIC, not a captured MRH receipt. It contains no
customer identity. Receipt ID `9223372036854775000`, transaction IDs ending in
`5001`/`5002`, and `msg_acceptance_<uuid>` identify the test. Global preflight
collision checks are mandatory; the numeric namespace alone proves no external
Etsy collision. Listing IDs and purchase-option IDs come from existing policies.
SKU and personalization are synthetic. `is_digital: false` follows the existing
repository reading fixture; exact real Etsy delivery compatibility is unproven.

Expected result: 1 Order, 2 LineItems, 3 Readings. Love quantity 2 retains the
existing `quantity_context` Needs Attention rule. Inbox finishes `ATTENTION` with
`PARTIAL`, not `SUCCEEDED`; this is expected domain behavior. The runner does not
allocate customer context or silently clear that hold. No generation, AI request,
PDF artifact or production queue change is allowed. No receipt API or worker loop
runs. Unrelated inbox rows must remain unchanged.

## UI verification after successful local execution

Use the app's existing base URL and log in to the same store:

1. `/orders?q=9223372036854775000`: one order with three Readings, expected Needs
   Attention state; verify product titles reflect the actual selected versions.
2. `/orders/<orderId>` printed by the runner: two lines, quantities 2 and 1,
   three Reading records and synthetic personalization. The runner verifies
   ProductVersion UUIDs through the existing detail query and prints them.
3. `/store`: Dashboard total and recent order list must include the test order;
   select a reporting period including today for Order Activity.

The runner checks `ordersData`, `orderDetailData`, `dashboardData`, total/period
order increments and recent-order visibility. Visual UI remains PENDING until a
person/browser actually inspects these pages. HTTP handler invocation is in-process;
this runner does not prove tunnel transport or real Etsy webhook delivery.
Production URL allowlist remains unchanged; real `openapi.etsy.com` event support
still requires independent evidence and a separate scoped change.

## Validation scope

Focused tests use pure functions, SQL predicate inspection and mocked persistence;
no PostgreSQL, PGlite, migrations or workers are executed. Existing signature,
Portal test, receiver and route regressions are reused. Native duplicate-order,
connection-epoch, tenant and UI acceptance remains pending local execution.

Preparation validation: 107 focused non-database tests passed; full application
TypeScript check and `git diff --check` passed. Acceptance commands were not run.


## Single-product runner fix

`--product-id` selects one transaction with quantity 1; both `preflight` and `run`
expect 1 Order, 1 LineItem and 1 Reading, no quantity-context hold, and inbox
`SUCCEEDED / IMPORTED`. The existing Love/Career argument mode is preserved.
Do not combine single-product and mixed-cart flags. All safety, mapping,
transaction rollback and collision checks remain mandatory.

The installed Drizzle postgres-js raw `execute()` returns an array of named row
objects, so `result[0]` was correct. PostgreSQL's explicit `inet::text` cast includes
`/32`, unlike normal inet display. The identity query now uses
`host(inet_server_addr())`. Extraction validates exactly one named row with string
identity fields and an integer port before checking every exact isolation value.
No result casting or permissive port/address normalization substitutes verification.
Source: https://www.postgresql.org/docs/18/functions-net.html

For the currently configured product, run read-only preflight first:

```sh
node --env-file=.env.webhook-test.local --import tsx scripts/acceptance/webhook/local-runner.ts preflight --store-id 1a181e14-116a-435c-a571-a8c200f50507 --product-id 83f56396-82eb-4384-b85c-cff26e74aecf
```

After it passes and writing is authorized:

```sh
node --env-file=.env.webhook-test.local --import tsx scripts/acceptance/webhook/local-runner.ts run --store-id 1a181e14-116a-435c-a571-a8c200f50507 --product-id 83f56396-82eb-4384-b85c-cff26e74aecf --confirm-disposable-db-write
```

These commands were not executed by Codex. Native runtime acceptance and visual
UI verification remain PENDING. The ACTIVE version is resolved from the DB, not
hardcoded to the user-reported version UUID.


## Transaction construction and safe failure diagnostics

The former run path called `drizzle(tx)` on a scoped postgres-js transaction.
That object provides `savepoint` but has no root `options` property. Drizzle's
constructor reads `client.options.parsers`, so construction raised TypeError
before `run()` or any acceptance write. The installed driver's behavior was
reproduced with a mocked client, without database access. For that demonstrated
failure, no acceptance records could have committed; the outer postgres-js
transaction rolls back callback failures.

The existing runner now opens `db.transaction(..., {accessMode: "read write"})`
and uses the actual Drizzle transaction object. Existing nested inbox/order
transactions use native savepoints, remaining inside the rollback boundary.
Server identity is still verified before writes and inside that transaction.

Abort output includes a stage, a strictly allowlisted application/driver error code,
and transaction outcome. Arbitrary error messages, query strings/parameters,
stack traces, raw payloads and credentials are not emitted. Wrapped Drizzle errors
are inspected only for allowlisted codes. Callback errors rethrown unchanged by
the driver report `ROLLBACK_REPORTED_BY_DRIVER`; commit/rollback transport failures
report `UNKNOWN`, never a false successful rollback. Successful commit followed by
an output/cleanup failure retains `COMMITTED`. Pre-transaction errors report
`NOT_STARTED`. These are driver reports, not independent DB-row verification.

Native acceptance remains PENDING; no DB connection or acceptance execution was
performed by Codex while fixing this path.

## Controlled live inbox event

The same runner supports read-only `inspect-live` and explicitly confirmed
`process-live`. Both require the expected Store, shop and current OAuth epoch.
The exact DB URL and live server identity are validated before either operation;
processing validates server identity again inside the rollback transaction.

```sh
node --env-file=.env.webhook-test.local --import tsx scripts/acceptance/webhook/local-runner.ts inspect-live --store-id 1a181e14-116a-435c-a571-a8c200f50507 --shop-id 67772322 --epoch 1
node --env-file=.env.webhook-test.local --import tsx scripts/acceptance/webhook/local-runner.ts process-live --store-id 1a181e14-116a-435c-a571-a8c200f50507 --shop-id 67772322 --epoch 1 --event-id INBOX_UUID_FROM_INSPECTION --confirm-disposable-db-write
```

Use the inbox UUID, not the Etsy message ID or receipt ID. Inspection returns only
eligible metadata (at most 100 records), never receipt bodies or grant material.
The operator must choose the event matching the intended purchase. Processing
checks owner access, connected grant, epoch initialization, topic, all selected
identities, retry limit, due time and pending/expired-lease state. Store-before-inbox
lock order is preserved. Completed events cannot be processed again with this
command. The generic worker behavior remains unchanged without a selector.

Live processing uses the production readOwnedReceipt adapter. It permits only the
exact selected Etsy receipt GET with redirects disabled. All other fetches,
including token refresh, AI, delivery and unrelated receipts, are blocked.
A grant expiring within 60 seconds, missing expiry, or an active refresh claim
requires separately authorized grant maintenance first; this runner does not
refresh it. Existing worker retry/attention handling remains intact: PROCESSED
means the bounded tick returned, not that intake succeeded. Inspect the returned
inbox status/result/error code. Worker retry state can commit; uncaught failures
roll back through the existing acceptance transaction wrapper.

No global worker is enabled. No receipt fixtures, signature skips or injection
routes are added. Existing signed durable acceptance is required to create inbox
rows. These commands have not been executed during implementation.
