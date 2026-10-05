# Local development

Requires Node.js 22.12+ (validated core with 22.23.1), pnpm 9.7.1 and PostgreSQL. No Etsy credentials, AI credentials, Redis, PDF engine or object storage are needed for the fixture demo.

## Installation and configuration

The base milestone branch now includes pnpm-lock.yaml. Use a frozen install to preserve its dependency graph. Auth.js remains unavailable in this authoring environment, so full runtime checks are still blocked here. Auth.js is pinned to 5.0.0-beta.30; review its beta status before deploying.

```sh
git clone https://github.com/yusufsaafa/etsy-reading-os.git
cd etsy-reading-os
# Check out the milestone branch if it has not been merged.
git checkout codex/ui-ux-design-lock
pnpm install --frozen-lockfile
node scripts/configure-local.mjs
```

The configuration script generates private random AUTH_SECRET, SECRET_ENCRYPTION_KEY and DEV_LOGIN_PASSWORD values and never prints them. Open .env.local locally to obtain the development sign-in password. Do not share or commit it. The script refuses to overwrite existing keys. .env.example documents additional settings.

## PostgreSQL

Use an existing local PostgreSQL database, update DATABASE_URL in .env.local, and create the dedicated database. Alternatively, if Docker is already available:

```sh
docker run --name etsy-reading-os-db \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=etsy_reading_os \
  -p 127.0.0.1:5432:5432 -d postgres:17
```

The password above is for a loopback-only disposable development instance. Production database credentials must be separately managed. This command is optional; Docker/containers are not an application dependency. Ensure the port is free; never run against an unrelated production database.

```sh
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open http://localhost:3000/sign-in and use DEV_LOGIN_PASSWORD. In another terminal:

```sh
pnpm worker
```

Seed creates one synthetic owner/store with six orders, seven line items and ten fulfillment units. Repeating seed preserves identities (it intentionally restores the two demo mappings). It does not connect to Etsy. In Settings, connect the demo store, open Advanced and request an update, and refresh to see the worker's result. Repeated import, including a duplicated receipt in the adapter, leaves counts unchanged.

## Demonstration path

1. Dashboard: actionable counts, no manufactured charts.
2. Orders: inspect the Love x2 + Career x1 checkout; it has three units.
3. Home / Orders: inspect customer information needed, product setup and recipient confirmation; use Needs info or contextual Needs attention.
4. Products: open Set up/Edit, confirm the purchased option explicitly; standard setup does not apply to variants automatically.
5. Order detail: review original inputs, correct/confirm each unit and observe a new context revision. No reading content is created.
6. Settings: disconnect and confirm pending sync is canceled; history remains.

Check at 390px, 768px and 1440px viewports, including keyboard, error states and interrupted actions. Those browser checks were not completed in the authoring environment because Auth.js installation was blocked.

## Checks

```sh
pnpm test
pnpm test:db
pnpm exec tsc --noEmit -p tsconfig.core.json
pnpm typecheck
pnpm build
```

test:db uses PGlite, the PostgreSQL WASM engine, with the actual generated migration and Drizzle SQL. It needs no running server and tests relational constraints and receipt transactions. It does not prove native PostgreSQL multi-connection concurrency, connection pooling or deployment behavior. Run a native PostgreSQL smoke test and concurrent-worker checks before deployment.

pnpm db:generate creates a migration after an intentional schema change. Review generated SQL and commit the migration plus metadata; use db:migrate for application, not schema push.

## Application authentication

Development credentials require all three: non-production NODE_ENV, DEV_LOGIN_ENABLED=true and ETSY_ADAPTER=fixtures, plus a password of at least 16 characters. There is no authentication bypass. GitHub OAuth is supported through Auth.js configuration; set AUTH_GITHUB_ID/SECRET and register /api/auth/callback/github. No provider tokens are intentionally stored in the application session. GitHub sign-in is separate from Etsy authorization.

Production IdP choice, login abuse controls and deployment/session policy still need review. Do not enable development credentials or seed synthetic owners in production. Keep Next.js actions behind the default origin/CSRF protections; do not weaken allowedOrigins to arbitrary sites.

## Live Etsy OAuth and intake

See ETSY_INTEGRATION.md. Set ETSY_ADAPTER=etsy, approved ETSY_CLIENT_ID/SHARED_SECRET, a registered HTTPS ETSY_REDIRECT_URI pointing to /api/etsy/callback, APP_URL/AUTH_URL matching the deployed application origin, a separately managed encryption key and ETSY_LIVE_OAUTH_ENABLED=true. Use application OAuth login in this mode; development credentials are disabled.

Do not use fixtures with real credentials. The skeleton contains OAuth exchange/refresh and shop-identity verification, but live intake remains an explicitly failing adapter until authorized listing/receipt contracts are verified. It does not silently substitute demo orders for live data. Local disconnect is supported; seller-side revocation in Etsy remains manual. Do not expose the development server publicly with development credentials.

## Troubleshooting

- Missing next-auth: complete pnpm install with registry access; the UI cannot run without the actual Auth.js package.
- Missing DATABASE_URL/unreachable database: check .env.local, database creation and port; scripts load .env.local explicitly.
- Store update remains queued: start pnpm worker. Retryable failures get at most three attempts; failed runs remain visible. A new sync command intentionally creates a new run after a terminal failure.
- Stale correction: reload to obtain the current unit revision before saving; original data and prior corrections remain intact.
- Etsy callback fails: check session, registered HTTPS URL, granted scopes and encryption configuration. Do not log callback codes, token responses or secret-bearing headers.
