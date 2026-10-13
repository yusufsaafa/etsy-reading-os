# Production launch preparation — Phase 1

Status: source preparation and isolated verification; **not a deployment or production acceptance**. Node 22.23.1 and pnpm 9.7.1 were used. No live Etsy/Gemini traffic, native application-database operations, push, infrastructure changes or deployment were performed.

## Shortest supported topology

Use one Linux deployment host/process manager initially: an HTTPS reverse proxy, a Next.js Node process, and separately managed worker processes. Use production PostgreSQL with backups and a private persistent POSIX artifact directory outside release/build/public paths. The app and PDF worker must use the same private directory and OS UID. Keep that directory when replacing/restarting releases; do not put it inside an ephemeral container/image or `.next`.

This reuses PostgreSQL queues, the existing AI gateway, renderer and filesystem artifact protocol. No Redis, new AI engine, new renderer, storage SDK or public PDF hosting is required. This topology is a supported configuration plan, not verification of any host, volume or provider. A horizontally scaled/serverless app without shared durable POSIX storage is not supported by this adapter; a future object-storage adapter is outside this launch slice.

## Launch configuration

Set these through the host's secret/configuration manager, not committed environment files. Do not copy `.env.local` or the webhook-test environment to production.

| Area | Variables / actions |
|---|---|
| Runtime | `NODE_ENV=production`; Node >=22.12.0; pnpm 9.7.1; `pnpm install --frozen-lockfile`, `pnpm build`, then `pnpm start` from the release root. Existing start binds `127.0.0.1`; use a same-host reverse proxy, or explicitly set an internal container listener using `pnpm exec next start --hostname 0.0.0.0 --port 3000`. |
| PostgreSQL | `DATABASE_URL` for an explicitly identified production database; provider-required TLS/private networking and a supported PostgreSQL server with PL/pgSQL, JSONB, advisory locks and `gen_random_uuid()`. Use a non-superuser application role and a separately authorized migration role. Migration job also requires `PRODUCTION_DATABASE_NAME`, `PRODUCTION_DATABASE_ROLE` and `PRODUCTION_MIGRATION_CONFIRM` equal to the exact database name. Never reuse local application/test connection values without verifying the target. |
| Auth.js / email accounts | Stable `AUTH_SECRET` and separate `AUTH_CODE_SECRET` (at least 32 random characters each), canonical HTTPS `AUTH_URL`, `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, and verified-domain `EMAIL_FROM`. Production customer registration/login does not require GitHub. `AUTH_TRUST_HOST=true` only behind a trusted proxy that replaces untrusted forwarded host/protocol headers. Optional existing GitHub access requires `AUTH_LEGACY_GITHUB_ENABLED=true` and GitHub credentials; it cannot create new production identities. See `ACCOUNT_SECURITY.md`. |
| Etsy OAuth | `APP_URL=https://<production-host>`, `ETSY_ADAPTER=etsy`, `ETSY_LIVE_OAUTH_ENABLED=true`, `ETSY_CLIENT_ID`, `ETSY_SHARED_SECRET`, `ETSY_REDIRECT_URI=https://<production-host>/api/etsy/callback`; register the exact redirect in the existing Etsy app. Current requested read scopes remain `listings_r` and `transactions_r`. |
| Token encryption | Stable `SECRET_ENCRYPTION_KEY` (32 bytes encoded as Base64), stable `SECRET_KEY_ID` (existing default is `local-v1`). Protect/back up these separately from Git; changing either without a supported rotation loses access to retained grants. If an existing DB is explicitly moved later, retain its encryption key/ID and ownership; no data transfer or identity reassignment is performed here. |
| Webhooks | `ETSY_WEBHOOK_SIGNING_SECRET` from the actual production app; HTTPS endpoint `/api/webhooks/etsy`. Current receiver uses exact signature/body/timestamp validation, durable inbox and store/epoch attribution. Real Portal/event interoperability remains unverified; accepted resource hosts are not widened. |
| AI | `AI_PROVIDER=google`, `GEMINI_API_KEY`, explicit `AI_GENERATION_MODEL` (existing default `gemini-3.5-flash-lite`), `AI_DAILY_BUDGET_NANOS`, `AI_ATTEMPT_BUDGET_NANOS` as nonnegative integer USD nanos. Choose budgets from the existing model reservation/pricing policy. Fake providers are forbidden in production. No inference was dispatched here. |
| Private PDFs | For independent Railway services, use `DOCUMENT_STORAGE_DRIVER=s3-compatible` and the private R2 variables/activation checks in [S3_STORAGE_DEPLOYMENT.md](S3_STORAGE_DEPLOYMENT.md). Alternatively use `persistent-volume` with `DOCUMENT_STORAGE_PERSISTENCE_CONFIRMED=true`, absolute `DOCUMENT_ARTIFACT_ROOT`, pre-provisioned durable root owned by the app UID with mode `0700`; both processes must see the same durable volume. Neither option falls back to ephemeral storage. |
| Packaged resources | Retain `resources/fonts` and `resources/platform` with the deployed release; tracing includes both. `DOCUMENT_ASSET_ROOT` optionally supplies the canonical private read-only resource root (default `<release>/resources`). Published tarot registry/preferred deck must exist if the selected document requires card artwork. |
| Optional operations | `INTERNAL_TOOLS_ENABLED=false` initially. If later enabled, `INTERNAL_OPERATOR_USER_IDS` must be explicit supported GitHub IDs. Do not set development login/account flags or development tunnel origins. |

Development-only `DOCUMENT_STORAGE_DRIVER=local` remains refused in production. The production persistent-volume adapter has no public URL, overwrite or removal interface. Preview/download remain session-owned, no-store, full-byte validated responses. Readiness checks never render or create artifacts. Back up PostgreSQL, artifact envelopes and encryption keys in a coordinated plan, with a tested restore; this phase does not provide a backup service or certify storage durability.

## Migration sequence

The journal has 32 consecutive entries (0000–0031), matching SQL files and strictly increasing migration timestamps. For an empty production database, apply the complete journal sequence. For an existing explicitly approved production target, Drizzle applies only unapplied migrations after its stored hashes/journal have been inspected; do not guess the starting migration from the application's HEAD.

The exact final dependencies are:
- 0019 `free_swarm`: document media snapshots; 0020 `clean_franklin_storm`: private artifact/document workflow tables and guards.
- 0023 `dusty_ultron`: retained purchase/configuration immutability; 0027 `automatic_receipt_intake`: persisted Store/epoch intake state.
- 0028 `etsy_webhook_inbox`: durable webhook inbox.
- 0029 `reading_first_assignment`: controlled one-time unit configuration assignment, retaining configured immutability.
- 0030 `review_draft_history`: immutable saved draft versions. Existing current revisions are copied; unavailable earlier bodies are not invented.
- 0031 `manual_delivery_history`: exact unit/artifact references and append-only manual confirmation/correction.

Use `pnpm db:migrate:production` only after the owner independently verifies the production server/database/role and authorizes the migration operation. The command reads injected `DATABASE_URL`, requires the explicit production target/confirmation variables above, checks server database/current/session role before migration writes, and does not load a local environment file. **It was not run here.** Migration application has been exercised in disposable PGlite; native production execution of 0030/0031 is NOT VERIFIED. Existing manual SQL migrations follow the repository's journal convention; review/synchronize Drizzle generation snapshots before future `db:generate` work rather than blindly generating duplicate tables.

## Background processes

Start with one instance per worker type; PostgreSQL inbox uniqueness, epoch checks, Store locks and production claim/token leases are correctness protections, not a recommendation to duplicate services.

| Process | Command after separate owner activation | Configuration / responsibility |
|---|---|---|
| Web | `pnpm start` | Authenticated UI and `/api/webhooks/etsy` receiver; receiver persists inbox only, never generates/sends a reading. |
| Webhook intake | `pnpm worker:etsy-webhooks:production` | `ETSY_WEBHOOK_WORKER_ENABLED=true`; configured signing secret/OAuth and persisted Store/epoch intake initialization; existing exact receipt retrieval, inbox retry/deduplication and unit persistence. |
| Polling/reconciliation | `pnpm worker:etsy-intake:production` | `ETSY_AUTOMATIC_INTAKE_ENABLED=true` plus each Store's explicit persisted activation/cutoff. Backup only if needed; overlap uses existing receipt/transaction/unit identities. |
| Generation + downstream PDF | `pnpm worker:production` | `PRODUCTION_WORKER_ENABLED=true`; uses existing `ProductionTick`, recovery/scheduler/executor, `CentralAIGateway` and `DocumentProductionWorker`. Startup requires Google/budgets and ready persistent storage. Defaults: interval 2 seconds, claim batch 4; optional `PRODUCTION_WORKER_INTERVAL_MS` (1000–60000) and existing `PRODUCTION_CLAIM_BATCH_SIZE`. |

Production commands do not load `.env.local`. Legacy `pnpm worker` is fixture-only and must not run in production. Leave activation flags false until production identity, ownership, product policies, backlog and configuration are reviewed. The webhook worker flag does not disable the receiver: withhold its signing secret until durable acceptance is authorized. Starting the generation worker may execute already-admitted eligible work; do not start it merely to test connectivity. Manual Prepare Reading/Prepare PDF retain existing explicit seller actions. No automatic Etsy delivery is introduced.

The worker entrypoints and Auth.js use bounded error codes instead of raw startup/provider/database exceptions. Capture stdout/stderr in access-controlled logs; alert on failed ticks, attention queues and storage failures. Avoid proxy/API debug dumps, authorization headers, SQL bind parameters and customer personalization. Gemini timeout is 120 seconds; allow graceful shutdown long enough for an in-flight bounded tick, and retain database fencing/recovery rather than forcing blind retries after interruption.

## Findings and owner actions

**BLOCKER / CONFIGURATION REQUIRED**
1. Choose host/domain and provision HTTPS, production PostgreSQL, durable private artifact root and backups. Neither target identity nor volume persistence/restore is verified here.
2. Configure Auth.js email authentication, verified-domain transactional email and Etsy application production URLs/credentials. Enable legacy GitHub access only if an existing owner needs it. Confirm the signed-in production identity owns the intended Store. Do not silently bridge development identities or copy a local DB.
3. Independently inspect production migration state, then separately authorize/apply the missing journal sequence. No protected native database is a test target.
4. Configure Google credentials, model/budgets, profile/published style, ProductVersions and a valid PDF design in the existing UI. Native production requests/rendering are not verified here.
5. If card imagery is required, provision the existing approved deck registry through an authorized operator action. Packaged files alone do not publish DB rows; the existing local-only deck CLI cannot provision a remote DB. The shortest first launch may use the supported text-only/no-card-imagery PDF design until that action is authorized.
6. Activate receiver/worker paths only after the intended Store/OAuth epoch and production app are verified. No real Etsy event has been processed during this preparation.

**IMPLEMENTED CODE-LEVEL CORRECTIONS**
- Explicit persistent-volume wiring reuses the existing immutable artifact adapter, rejects unconfirmed durability and never creates a missing production root.
- Executable opt-in production tick worker and environment-injected production migration/intake commands reuse existing engines and guards.
- Same-origin referrer policy preserves form Origin validation in production while withholding external referrers; private PDF responses retain their own no-referrer policy.
- Reproduced and corrected recovered Etsy answer handoff: review now uses the same retained purchase-to-input resolution as generation, while preserving original input rows, revision checks and immutable bindings.

**RECOMMENDED**: restricted app DB role, coordinated backup/restore, worker/log alerts, restart policy, resource limits and large-shop list/queue latency measurement. Delivery readiness inspects matched PDF bytes before pagination; scaling is not silently claimed solved.

**DEFERRED**: object-storage/horizontal scaling, unrelated SaaS features, live historical acceptance, automated customer delivery and new acceptance frameworks.

## Verification and commit exclusions

Production webpack build and full TypeScript check pass with a child build environment that disables live credentials/workers and uses a non-application DB placeholder. Focused unit tests cover production guards, storage restart/missing-root safety, webhook auth, recovery tools, review/download/delivery and UI changes. Isolated PGlite tests cover journal application, intake idempotency, first assignment, review/document handoff and worker recovery. No native application/test databases were contacted.

Pending-file review read all changed/untracked text files; credential-pattern scan found no matches and no environment/local DB/binary artifacts in the pending set. Generated `next-env.d.ts` and Next-modified `tsconfig.json` are preserved but excluded from commits. The build's tooling-file changes are not treated as authored application work. Environment files, local data and `.next` remain outside commits; no questionable file is deleted.

### Recorded check results

- Final focused unit run: 25 files / 305 tests passed.
- Initial isolated PGlite run: first assignment, controlled intake, webhook inbox, artifacts and production recovery — 5 files / 237 tests passed.
- After the reproduced recovery-to-review correction: generation/review, artifacts and first assignment — 3 files / 162 tests passed. Counts overlap with the initial run and are not additive.
- Production guard/storage/runtime follow-up: 26 tests passed; no worker or migration entrypoint was executed.
- Final `pnpm typecheck --incremental false`, production webpack build and `git diff --check`: passed.

The recovered-answer regression first failed with `REVIEW_UNAVAILABLE`, then passed after review adopted existing `mappedCustomerAnswers`. Its original input rows and binding remained unchanged. The production build used an isolated child environment, disabled live credentials/workers and a non-application DB placeholder. Build output and local env files are not committed.

S3-compatible shared private PDF storage is now available for independent Railway web/worker services; see [S3_STORAGE_DEPLOYMENT.md](S3_STORAGE_DEPLOYMENT.md). The persistent-volume option remains supported. Provider-specific R2 verification is required before activation.
