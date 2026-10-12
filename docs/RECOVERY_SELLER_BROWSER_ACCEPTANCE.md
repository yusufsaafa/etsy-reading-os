# Controlled seller recovery browser acceptance

Native PostgreSQL acceptance (10/10) is accepted as reported by the user. Do not rerun it. This follow-up is still **PARTIAL** until the authenticated browser flow is observed.

Browser tooling is available. The Codex shell still cannot connect to the retained PostgreSQL database, so the guarded launcher must be run manually on the macOS host. No database operations or app launch were executed from Codex.

## Host startup

```sh
cd /Users/yusufsafakilic/.codex/.chatgpt-projects/g-p-6ac38d2133b08191a7f586ecfca5ff59/etsy-reading-os
export PATH="/Users/yusufsafakilic/.nvm/versions/node/v22.23.1/bin:$PATH"
read -rs 'DEV_LOGIN_PASSWORD?Choose a synthetic demo password (16+ characters): '
export DEV_LOGIN_PASSWORD
RECOVERY_BROWSER_CONFIRM=etsy_reading_os_recovery_acceptance pnpm acceptance:recovery-browser
```

Optional `RECOVERY_ACCEPTANCE_PASSWORD` is used only if the verified database role requires a password. The script never prints it or the synthetic login password. Keep this Terminal running. Do not use plain `pnpm dev`, which could load the original application's database URL.

## Host launcher behavior

The launcher connects only to `etsy_reading_os_recovery_acceptance` as `yusufsafakilic` at `127.0.0.1:5432`, using the existing target denylist and identity guard. It does not create, drop or migrate databases. Before fixture writes it compares migration hashes/timestamps, verifies the two expected synthetic fixture stores and synthetic-only users/purchases, disconnected token-free Etsy connections, retained native assignment approvals and zero generation/queue/AI/PDF work. Any mismatch stops startup.

It adds one historical quantity-one synthetic receipt (99000, transaction 99001) through existing intake, leaving its Reading unconfigured. It verifies compatible versions are available. Existing native test purchases are not reset or rebound. The existing `dev:owner` development-login identity is linked only to synthetic studio A, refusing any other ownership, and existing profile/style services provide synthetic readiness prerequisites. Those are fixture provisioning operations inside the acceptance database, not application authentication changes.

The Next.js development process runs on loopback port 3100 with fresh synthetic session secret, fixture Etsy adapter, disabled live OAuth/polling/webhooks, fake deterministic AI and no GitHub provider. Local env-file keys are blanked in the child environment before the explicit safe values are installed, preventing Next from loading the original application's secrets or database URL. No environment file is changed, no worker is started and no generation or PDF method is invoked during setup.

If receipt 99000 has already been recovered, the launcher refuses to reset it. Do not rerun native acceptance or alter an immutable version to obtain another attempt. A separately authorized fresh browser fixture can be prepared if needed. Startup may produce normal Next development output; inspect the working tree afterward for generated tooling changes.

## Seller checklist

1. Open `http://127.0.0.1:3100/sign-in` in a fresh browser tab. Expand **Development demo account** and enter the password you chose. This is the existing authenticated credential provider, not an auth bypass.
2. Confirm the operations workspace loads and `/orders` lists synthetic purchases. The launcher prints the exact receipt-99000 Order Detail URL.
3. Open that Order Detail and confirm the one Reading is **Unconfigured**, with purchased listing/option/customer evidence visible. No generation should be available yet.
4. Expand **Assign first reading configuration**. Review Purchase Information and a matching published version's sections, input fields and historical-publication notice. Select that version, check the explicit approval and confirm first assignment.
5. Confirm the success feedback, immutable retained configuration reference and configured lifecycle state. The configuration-selection action should disappear. Purchased information should remain visible.
6. Confirm **Prepare reading** becomes available after existing product, input and profile/style prerequisites. Do not press Prepare, generate PDFs, deliver or send messages. The required endpoint is available admission, not AI execution.
7. Record observed results for app startup, authentication, Orders, evidence, selection, confirmation and generation availability. Do not claim PASS from launcher output alone.

## Static verification

The environment isolation checks and launcher source safeguards have three database-free tests. Full `pnpm typecheck --incremental false` and `git diff --check` passed. No native tests were repeated. Authenticated startup/recovery results remain NOT VERIFIED until host startup and browser observation.
