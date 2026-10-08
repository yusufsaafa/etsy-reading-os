# Real Store generation setup — Part 1

Date: 2026-10-09 (Europe/Istanbul). Starting HEAD: `1abcbc72be7307f41bed7d5ed5ed1f57a891a301`. Branch: `codex/ui-ux-design-lock`.

## Outcome

Owner-controlled setup is available without rebuilding Product, Generation or PDF systems. The first real MysticReadingHouse Gemini + PDF test is **NOT READY until the owner completes the actions below and separately authorizes execution**. No real configuration action was performed on the owner's behalf.

No Etsy API request, real adoption, ingestion, Reading creation, provider dispatch, real PDF render, real artifact upload or delivery occurred. Storage tests used only disposable synthetic files. No live design or ProductVersion was created, published or assigned. `.env.local`, OAuth grants and real database state were not changed. No migration, dependency, push or deployment.

## Real persisted inspection

A localhost-checked PostgreSQL repeatable-read/read-only transaction uniquely located the requested target listing and owned active mapping. Repeating inspection after implementation returned the same results:

| Check | Finding |
|---|---|
| Store / source | MysticReadingHouse / Etsy |
| Connection | Connected; shop identity and encrypted grant present. API usability not freshly tested. |
| Mapping | One exact approved combination, two stable purchase-property identities. Other combinations not activated. |
| Published version | v3 ACTIVE; no immutable product title metadata. |
| Buyer input | One required LONG_TEXT definition; complete-answer mapping retained; help text empty. |
| Content / output | One approved reading section; PDF; ASSISTED workflow. |
| Designs / assignment | Zero Store designs; zero Product assignments. |
| Local storage | Driver and root absent. |
| Internal access | Disabled; no allowlist configured. |

No buyer answers, private IDs, raw payloads or credentials were printed. The prior accepted catalog has six combinations; no new inventory read was performed. Canonical source policy remains authoritative, independent of labels.

## Architecture and UI paths

- Existing Product edit/save/activation services clone drafts, preserve published configuration, and pin `product-metadata/v1` on explicit activation. No new republication command.
- Product Setup contains a collapsed **Generation test setup** panel. It reads Store-owned active configuration, existing design resolution, read-only local filesystem readiness and current-session internal capability. No client state authorizes readiness; no paths or operator identities are returned.
- `/products/[product-id]/document-design` now supports controlled creation, configuration inspection and separate assignment through existing commands.
- These owner pages reuse the existing onboarding shell before completion and existing operations shell afterwards. Previously, operations-only placement redirected incomplete onboarding away from PDF appearance. The route-group change repairs that gap without changing its URL or global shells.
- `/settings/local-access` is a development-only, authenticated Store-owner self-identity page. It shows only the current session's exact GitHub subject, grants no capability, and returns not-found in production. Development setup links open in a new tab to preserve unsaved work.

## Explicit Product republication

1. Sign in normally. Open Step 4 at `/onboarding/products/setup` while onboarding is incomplete, or **Products** afterwards.
2. Open the target listing and **already approved exact purchase combination**. Do not activate other combinations.
3. Click **Edit product** on the published summary. This explicitly creates/reuses one cloned draft. If a draft exists, review its saved edits rather than replacing them.
4. Verify the authoritative Product name, exact options, complete-answer mapping, intimacy section instructions, PDF output and preparation policy. Preserve the configuration unless deliberately approving edits. No label-based depth inference or tarot requirement.
5. **Save draft** does not publish. After review, explicitly click **Activate product**. Existing validation and fresh catalog checks apply. Publication pins the approved name; old v3 configuration remains immutable and is archived through the existing lifecycle.
6. Reload and confirm **Approved product title ready**. No Reading or production work is created.

The new version has a new activation fence. Historical purchases need fresh review/adoption against that exact version and fingerprint; existing approvals/Readings are not rebound. Product names retain the existing 100-character bound.

## Explicit first design creation and assignment

1. Open **Manage PDF appearance** / **Choose PDF appearance** from Product Setup in a new tab.
2. Enter a design name and approved studio name. For this target, use MysticReadingHouse attribution, not an invented individual reader.
3. Choose **Minimal** or **Classic** and controlled **Inter** / **Source Serif 4** heading/body fonts; optionally enter a plain-text footer. Review included appearance.
4. Check **I have reviewed and approve this design configuration**, then **Create approved design**. Existing `createDocumentDesign` creates ACTIVE revision 0: there is no separate draft/publication phase. This deliberate command is the approval step.
5. Inspect available configuration: layout, studio, fonts, cover, colors, display settings and footer. No arbitrary HTML/CSS, raw JSON, executable template or external asset inputs.
6. Choose the design and explicitly **Save design assignment**. Creation alone never assigns it. Confirm assigned name/revision and `DESIGN_READY` / **Document design assigned**.

The controlled configuration includes brand cover, approved title and resolved attribution, reading date, section separators, optional footer and page numbers. Customer names, cards and portraits are disabled; no branding image is added. Existing deterministic pagination handles long paragraphs/multiple pages and controlled fonts. Snapshots pin the design revision. No real customer preview/render is executed here.

Creation remains the existing deliberate non-idempotent create command: repeat only to create another design. Assignment is replay-safe. Viewing creates no design, draft or artifact. Cross-Store, invalid-font/template and unapproved creation fail closed.

## Private local storage procedure — not executed

Current local configuration is absent, therefore **not configured**. From the checkout, deliberately create a stable private directory under your home:

```sh
umask 077
mkdir -p "$HOME/.local/share/reading-os/private-artifacts"
chmod 700 "$HOME/.local/share/reading-os/private-artifacts"
python3 - <<'PY'
from pathlib import Path
import os, stat
root = (Path.home() / ".local/share/reading-os/private-artifacts").resolve(strict=True)
info = root.stat()
assert root.is_dir() and info.st_uid == os.getuid()
assert stat.S_IMODE(info.st_mode) == 0o700
assert root != Path.cwd().resolve() and Path.cwd().resolve() not in root.parents
print("DOCUMENT_STORAGE_DRIVER=local")
print("DOCUMENT_ARTIFACT_ROOT=" + str(root))
PY
```

Inspect an existing directory before changing permissions; do not reuse a symlink or another application's storage. The printed path is private operator information, never browser output. Copy the two resulting values into `.env.local`, replacing only those keys, preserving all unrelated variables. Do not commit environment/storage/artifacts. Do not use `/tmp`, `public/`, `.next/`, dependency directories or a repository subdirectory. Restart the development server.

Reload Product Setup. **Private local storage ready (development only)** requires a canonical existing directory, app-user ownership, private owner read/write/search permissions and a location outside the repository. The probe creates/chmods/uploads nothing. Missing/unsafe roots report invalid configuration. Actual storage operations still enforce content/hash/size and ownership. Readiness is not an upload test or durability guarantee.

Local filesystem storage is rejected in production. Durable private storage, credentials, retention/backups and shared worker/download adapter remain deployment dependencies; no external provider was configured.

## Internal operator procedure — disabled until opt-in

1. Sign in with GitHub OAuth on the local development server.
2. Open `/settings/local-access`. Use only your authenticated `github:<numeric-account-id>` shown there; do not guess a username or enumerate identities.
3. If internal review is intended, copy the exact settings shown into `.env.local`:

```dotenv
INTERNAL_TOOLS_ENABLED=true
INTERNAL_OPERATOR_USER_IDS=<your exact authenticated github subject>
```

4. Preserve unrelated variables, restart, sign in normally and confirm enabled status for your session. `/etsy/historical-review` still requires existing Store ownership and exact capability checks.

No enablement occurred. Store ownership alone is insufficient. Disabled/malformed configuration or unallowlisted identity denies access. Production policy is unchanged: supported explicit GitHub subjects plus Store authorization. The self-identity page is unavailable in production; no tokens, cookies, other users or allowlist are shown. Enabling review is not adoption/ingestion/generation approval.

## Status and safety semantics

Title ready/republication required, design ready/missing/invalid, storage ready/missing/invalid/production dependency and internal access enabled/disabled/not-authorized are separate server-owned statuses. **Configuration prerequisites complete** covers title/design/local storage only, never overall eligibility. Real Reading, source/status/timing/input gates and separate execution authorization remain required. Internal access matters for historical review, not every normal new order.

Status viewing is read-only. English, platform style fallback, original customer answers, purchaser separation, exact source identities, immutable versions, preparation/derived priority and queue/review/delivery gates are unchanged.

## Files changed

- Design page/actions moved to `src/app/(store-setup)/products/[id]/document-design/`, same URL; existing-shell selector `(store-setup)/layout.tsx`.
- Local self-identity: `(store-setup)/settings/local-access/page.tsx`, `src/modules/identity/local-subject.ts`.
- Controlled design choices: `src/modules/documents/owner-design.ts`; existing creation/assignment services reused.
- Owner status: `src/modules/products/generation-setup.ts`, `src/components/products/generation-setup-status.tsx`, `setup.tsx`.
- Storage probe: `src/infrastructure/local-artifact-storage.ts`, `document-runtime.ts`; runtime also rejects repository roots.
- Focused unit/UI/DB tests and this report. No schema, migration or dependency changes.

## Validation and limits

- **144 unit/render tests across 11 files passed**: approval, controlled choices, no creation on viewing, separate assignment, owner statuses, self-session format, production denial, default-disabled capability, both shells, storage checks and existing Product/PDF layout behavior and verified controlled font resources.
- **27 isolated DB tests across 2 files passed**: legacy-v3 republication, immutable old configuration, exact binding/mismatch rejection, no Orders/Readings/Generations, design ACTIVE status, owned assignment/revision, invalid configuration/cross-Store denial. Existing migrations apply freshly in disposable databases.
- `pnpm typecheck`: PASS. Production `pnpm build`: PASS. `git diff --check`: PASS. Known generated Next.js diffs preserved and excluded from commit.
- Initial fixture failures (deferred pointer transaction), test mock/HTML assertion/typing and generated route types were corrected; no production constraint was relaxed.
- Browser/live owner action acceptance is **NOT VERIFIED**. No real publication, design submission or PDF occurred. Fixture/render tests do not prove real customer PDF acceptance.

## First controlled test checklist

- [ ] Explicitly republish only the chosen configuration; verify approved title and Store attribution/scope.
- [ ] Explicitly create and assign the approved design; `DESIGN_READY`.
- [ ] Configure stable private local storage; verify status after restart.
- [ ] Enable exact authenticated internal capability if historical review is needed.
- [ ] Fresh exact purchase/version/fingerprint review; separate adoption/intake authorization if historical.
- [ ] Persist eligible Reading via controlled intake with production suppressed; verify unchanged complete answer and policy.
- [ ] Separately authorize one bounded Gemini request after provider privacy/content/budget review.
- [ ] Review/approve output before separately authorized private PDF/storage/download validation.

No test execution or buyer contact is authorized here. `ETSY-INPUTS-01`, `ETSY-E2E-01`, `ETSY-CARDINALITY-01` remain OPEN. Owner configuration, eligible Reading and explicit execution approval remain blockers; production storage remains a deployment dependency.
