# Milestone 6.3S — host-executed native recovery acceptance

**RUNNER PREPARED — HOST EXECUTION REQUIRED.** No native PostgreSQL result is claimed. Codex only typechecked the code and executed database-free guard tests.

## Run from macOS Terminal

```sh
cd /Users/yusufsafakilic/.codex/.chatgpt-projects/g-p-6ac38d2133b08191a7f586ecfca5ff59/etsy-reading-os
export PATH="/Users/yusufsafakilic/.nvm/versions/node/v22.23.1/bin:$PATH"
node --version
pnpm --version
RECOVERY_ACCEPTANCE_CONFIRM=etsy_reading_os_recovery_acceptance pnpm acceptance:recovery-native
```

Node >=22.12.0 and the existing installed pnpm dependencies are required. The expected branch is `codex/ui-ux-design-lock` and HEAD is `034c111bddd9f0ff870f5a7b54118a1143a403cb`. Do not commit or reset the working tree before running.

Required variable: `RECOVERY_ACCEPTANCE_CONFIRM=etsy_reading_os_recovery_acceptance` explicitly authorizes creation, migrations and synthetic fixture writes to that one new database. Optional: `RECOVERY_ACCEPTANCE_PASSWORD` if the `yusufsafakilic` role requires a TCP password; supply it privately through the shell environment, never paste credentials into reports. Password defaults to empty. No `.env` file or `DATABASE_URL` is loaded or reused; PG environment overrides are cleared.

## Isolation and guards

The only connection targets are fixed TCP `127.0.0.1:5432`, role `yusufsafakilic`, databases `postgres` and `etsy_reading_os_recovery_acceptance`. The protected databases `etsy_reading_os` and `etsy_reading_os_webhook_test` occur only in a denylist and guard tests, never an executable connection target.

Before writes, the runner verifies maintenance database, role, TCP server address/port, runtime, repository identity, complete ordered migration manifest and create-database privilege. It checks that the acceptance name does not exist and refuses any reuse, even of a database left by an earlier acceptance attempt. It creates only that fixed name using `template0`, then verifies its identity/OID and independent backend PIDs. Identity and OID are rechecked before migrations and each test phase. The migrations are only applied through the acceptance connection. Existing SQL migration 0029 is unchanged.

There is no automatic database drop or cleanup. On success, failure or interruption the database is retained. A retry with the same database present fails closed. Do not point another application or worker at this synthetic database during acceptance. Creation races fail closed; no existing database is substituted.

Every connection has a 5-second connect timeout, 20-second statement timeout, 5-second lock timeout and 15-second idle-transaction timeout. The runner verifies server-side timeout values, limits each client to one backend and has a 180-second overall deadline. Connections are closed on normal exit; pending transactions roll back on disconnect. A timed-out/failed run is never reported as PASS.

The runner forces fixtures, removes application/provider/worker connection settings, blocks HTTP through `fetch`, never imports/calls GenerationService, provider dispatch, renderer or delivery, and asserts there are zero Generation, AIRequest, UsageEvent, production queue or PDF artifact/snapshot rows after every check. The host process uses the maintenance database only for preflight/creation and read-only lock observation.

## Native checks

- Full migration sequence including 0029; journal hashes/timestamps/count and replay consistency; approval table triggers, uniqueness, evidence/revision checks, owned foreign keys and original unit immutability trigger.
- Null/unconfigured generation rejection and direct SQL first-binding rejection without an approval.
- Existing assignment service: valid first assignment, same-version replay, different-version conflict, exact owned listing/options and cross-tenant rejection. Invalid raw approval inserts also fail.
- Configured version replacement and configured-to-null rejection; approval update rejection.
- Purchased Order/LineItem/source evidence and customer input rows/revisions remain unchanged. A seller correction remains authoritative and stale revisions conflict.
- Missing buyer input and quantity-allocation holds remain generation blockers. Quantity-expanded unit IDs, indexes and untouched siblings are retained.
- Existing generation-context admission succeeds with the immutable assigned version and synthetic buyer answers, without dispatch. Recovered ASSISTED admission remains manual.
- Independent PostgreSQL connections compete for one Reading. A separate control connection holds the Store lock until **both** service backends report `wait_event_type='Lock'` through PostgreSQL's activity view. Then it releases the lock. Different versions yield one ASSIGNED winner and one ASSIGNMENT_CONFLICT; same-version contention yields ASSIGNED plus ALREADY_ASSIGNED. Exactly one approval and a matching immutable final binding are required, with no partial state or duplicate work.

## Output and exit codes

Expected successful backend output includes:

```text
Database: etsy_reading_os_recovery_acceptance; role: yusufsafakilic; host: 127.0.0.1:5432; independent connections verified
PASS: valid first assignment, purchase identity and generation context
PASS: two-connection different-version contention: one winner, deterministic conflict
PASS: two-connection same-version contention: assigned and idempotent replay
Native PostgreSQL backend: PASS (10 checks); AI/HTTP/queue/document writes: zero
Seller browser flow: NOT VERIFIED (runner does not start an application or authenticate a browser)
Overall Milestone 6.3S: PARTIAL — browser seller-flow acceptance remains; database retained, never dropped
```

Exit 0 means all native backend checks passed. Overall 6.3S remains PARTIAL because this runner does not verify an authenticated browser workflow. On any prerequisite/test/timeout failure the runner reports `FAIL`, the stage, sanitized code and completed check count, and exits nonzero. It never prints raw PostgreSQL exceptions, SQL parameters or credentials.

## Remaining acceptance

The runner does not start Next.js, establish an authenticated session, run regression suites, access Etsy, generate PDFs or make AI calls. Native results are not available until the user executes it. Retain Terminal output as evidence, then separately prepare an isolated application/browser acceptance against the retained synthetic database with all external actions disabled. Do not change application security or use either protected database to perform that follow-up.

## Identity formatting correction

The first host attempt stopped before database creation with `DATABASE_IDENTITY_MISMATCH`. A source defect was identified: `inet_server_addr()::text` includes the IPv4 `/32` netmask, so it fails an exact comparison with `127.0.0.1`. The runner now queries `host(inet_server_addr())`, which returns the address alone. The exact address, role, database, port and OID checks remain. Unix sockets (NULL address), IPv6 and other addresses are still rejected. This is PostgreSQL formatting behavior, not a macOS-specific connection exception. See PostgreSQL's network-functions documentation: https://www.postgresql.org/docs/16/functions-net.html.

Identity failures now print only fixed failed-field labels (`row`, `database`, `role`, `address`, `port`, `oid`), without actual values, passwords or connection strings. The raw failed row was not captured, so any additional mismatch is not known. The runner was not rerun from Codex; native results remain unverified. A host retry still refuses an existing acceptance database before any migration/fixture write.
