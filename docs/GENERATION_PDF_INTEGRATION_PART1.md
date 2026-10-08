# Generation & PDF integration — Part 1

Implementation date: 2026-10-09 (Europe/Istanbul). Starting HEAD: `21b73795f38b8f1298475d981026608c85ac0637`. Branch: `codex/ui-ux-design-lock`.

## Outcome and scope

Existing Product, Generation, Central AI Gateway, review, document snapshot, deterministic PDF, artifact persistence and production worker boundaries are connected without creating another engine or changing canonical section validation. Synthetic isolated acceptance passes. **The real MRH Product is not yet ready for an authorized Gemini + PDF test:** its legacy published version needs explicit owner title republication, an approved design assignment and local storage configuration. An eligible real Reading and separate paid-test authorization are still required.

No real Etsy receipt was retrieved; no real adoption, ingestion, Generation, PDF, artifact upload or delivery occurred. No live ProductVersion, design, OAuth grant or environment configuration was changed. No push or deployment. Synthetic PDF bytes were rendered only inside disposable test fixtures, then removed; they are not real customer artifacts.

## Architecture and immutable metadata

| Boundary | Change |
|---|---|
| Product publication | Existing `activateProduct` pins `productMetadata` / `product-metadata/v1` with the owner-approved Product name. Client metadata cannot override it. |
| ProductVersion | Metadata lives in the existing bounded configuration, protected by existing published-version immutability; no new table or migration. |
| Controlled Etsy OrderLine | New resolved lines use the version title. Existing line titles are retained on replay; held lines have a neutral unconfigured title. |
| GenerationContext | New admissions carry `integrationVersion: generation-context/v2`, resolved product title/source, complete approved configuration and unchanged answers. |
| Prompt | New contexts include title, exact purchase identity set, output/preparation policy, and all customer-field key/label/type/helpText/required metadata. Original answer values appear once in customerContext. |
| Generation replay | Context/hash remain immutable. Contexts without the integration marker retain the original prompt shape and original system rules; retries do not acquire new metadata from current Product/Store state. |
| Review handoff | Approved document input takes title from the pinned generation configuration and attribution from its seller identity snapshot, never from generated prose or generic OrderLine title. |
| DocumentSnapshot | Bounded optional reader and title-source provenance are copied and hashed. Historical snapshots without these fields remain readable with their original hash. |
| Layout/PDF | New attributed covers display “Prepared by” with the same resolved identity used in generation. Attributed layouts use `reading-layout/2`; legacy no-reader layouts retain `/1`. The physical renderer and canonical section validation are unchanged. |

The approved Product name is the authoritative title, not mutable current Etsy metadata or buyer text. Product names retain the existing 100-character bound. Current listing titles may be longer; no new title authority is inferred from them.

### Legacy safety

Published versions lacking a historical title snapshot use **“Personalized reading” / LEGACY_FALLBACK**. There is no mutable Product-name lookup masquerading as a versioned historical title, and no silent backfill. To obtain the actual approved title for MRH, the owner must explicitly edit/review and republish through the existing Product workflow. That creates a new version; it does not rewrite v3 or historical bindings. A historical candidate must subsequently be reviewed against the exact chosen version, not automatically rebound to the new one.

Old Orders are not rewritten. Existing document snapshots/artifacts keep their identities. A new explicitly requested document snapshot may carry the newly supported metadata from its retained Generation; it cannot overwrite an older artifact.

## Customer semantics, scope and attribution

Customer field definitions and original answers are separate parts of the same JSON user-data envelope. Help text remains seller-authored description data, not validation logic or platform authority. It now reaches the model in new contexts; it does not introduce person/date extraction. Optional missing answers remain absent. Required inputs continue to use existing deterministic admission checks.

New context rules explicitly prohibit inferring relationship roles from name order, inventing missing facts or treating field descriptions as customer evidence. Customer text and seller metadata cannot become system instructions. Injection protection is a boundary and safety instruction, not a claim that models are immune to injection. No privileged tools or delivery decisions are delegated to output.

Exact Etsy property/value identities remain pinned in the existing Product policy. Reading sections and instructions are unchanged. No depth/tier dictionary, label/SKU inference, tarot media or extra configuration activation was added. Preparation targets/priority are operational policy, not narrative depth or guaranteed timing. English and existing style provenance/retry rules remain pinned.

Reader attribution comes from the existing Generation seller snapshot: approved SellerProfile when configured, otherwise explicit Store-name fallback. No named reader is invented. MRH can therefore retain MysticReadingHouse attribution without a new persona subsystem. Changing a seller profile after generation does not change that generation's document attribution.

## Owner design assignment

The domain already provided validated ACTIVE designs, owned assignment, Store-default resolution and immutable document snapshots. It was reused.

- Owner page: `/products/[id]/document-design`.
- Product Setup’s PDF section opens “Choose PDF appearance” in a new tab, preserving unsaved form state.
- The page lists only existing owned ACTIVE designs. Its explicit server action calls `assignDocumentDesignToProduct`; viewing never creates, publishes, assigns or renders anything.
- Existing owner command `createDocumentDesign` remains the design creation boundary. This milestone adds assignment of existing designs, not a full design creation/editor UI. If none exist, the page says so; a design must first be explicitly created using the established owner service.
- `documentDesignSetup` exposes DESIGN_READY, SETUP_REQUIRED and INVALID_CONFIGURATION while keeping the existing resolver’s RESOLVED contract intact.
- Cross-Store, archived, invalid-font/template/resource configuration and stale references remain rejected. Each document freezes the exact design revision/configuration; later assignment/design edits do not alter retained snapshots.

**No design was created or assigned to MysticReadingHouse.** Its current missing-design state remains legitimate and fail closed.

## Private artifact storage and runtime wiring

No configured external storage provider or existing concrete adapter was found in local configuration. A dependency-free local adapter implements the existing `ImmutableArtifactStorage` port:

- Canonical absolute private root, outside public/static/build/dependency directories; root requires app-user ownership and 0700 permissions; files are 0600.
- Strict canonical organization/Store/Reading/media/hash keys; actual filenames are opaque hashes, with no buyer answer or name in paths.
- One bounded envelope contains exact key, MIME, size and digest evidence plus PDF bytes. Only application/pdf and matching content digest/length are admitted.
- Exclusive temporary file, file fsync, atomic conditional hard-link publication, directory fsync and temporary cleanup. No overwrite or deletion capability exists on the adapter.
- Retry/concurrent identical publication verifies the existing complete object. Conflicts or tampering fail closed.
- Reads reject symlinks, arbitrary keys, traversal, invalid identity/permissions and unbounded sizes. File reads stop at the bound plus metadata/sentinel, including concurrent growth. Existing artifact service performs another authoritative size/hash check.
- Organization is enforced by the adapter; Store/Reading/artifact ownership is enforced by the existing database services before access. An adapter is not an independent browser authorization endpoint.

`configuredDocumentPorts` supplies this adapter and optional bounded read-only platform assets to existing `productionRuntime`. Constructing ports/runtime never executes work or creates an artifact directory. No recurring worker, scheduler changes, model call or automatic delivery was added. NONE-media psychic readings need controlled fonts, not a tarot image root.

### Local configuration (not applied here)

```dotenv
DOCUMENT_STORAGE_DRIVER=local
DOCUMENT_ARTIFACT_ROOT=<canonical absolute private directory>
# Optional; needed only when approved media requires platform card images:
DOCUMENT_ASSET_ROOT=<canonical absolute read-only platform asset root>
```

Use the OS canonical path (macOS `/var`/`/tmp` aliases may resolve under `/private`). Do not use a public directory or commit artifact contents. A new artifact directory is created privately only by an explicitly authorized upload. An existing permissive root must be corrected by its operator, not silently chmodded by the adapter. A crash may leave an unreferenced private `.pending` file; operator cleanup must never delete published `.artifact` files blindly.

**Local filesystem storage is not durable production storage.** The environment factory rejects `local` in production. Deployment must supply a durable private implementation of the existing ports to the trusted worker and extend the same server factory for downloads, with conditional creation, bounded reads, backups/access/retention policy and deployment credentials. No external service/account/credential was introduced or silently assumed ready. Production PDF operation remains blocked until that dependency is supplied.

## Authenticated download

`GET /api/readings/[readingId]/artifacts/[artifactId]`:

1. Requires the existing authenticated session; anonymous access gets 401.
2. Derives Store scope through existing membership authorization, never client tenant claims.
3. Resolves the exact owned Reading/artifact relationships before consulting storage.
4. Uses existing `retrieveDocumentArtifact` integrity/availability checks.
5. Returns application/pdf attachment with a UUID-derived safe filename, bounded Content-Length, private/no-store caching, nosniff, sandbox CSP and no-referrer.

No URL/object key/path parameter, raw storage key, filesystem path or private error detail is exposed. Foreign/malformed/unavailable artifacts return a controlled error. Missing local storage is a controlled unavailable response. Download does not approve or deliver a reading. The route currently follows the application's existing single-current-Store session convention.

## Internal operator capability

Historical review now requires both independent internal capability **and** its existing Store-owner authorization. The centralized server policy protects the page, direct server actions, discovery/read functions, review creation/confirmation and fresh revalidation commands before receipt/database operations.

```dotenv
INTERNAL_TOOLS_ENABLED=true
INTERNAL_OPERATOR_USER_IDS=<explicit authenticated subject IDs, comma-separated>
```

Production accepts only explicit `github:<account-id>` allowlisted identities; a normal Store owner or development credential is insufficient. Missing, malformed, wildcard or disabled configuration fails closed. Unknown runtime modes fail closed. Development/test access also requires the explicit flag and exact authenticated ID; existing OAuth/development authentication must still establish the session. There is no anonymous or automatic owner bypass.

For legitimate local historical review, the developer must explicitly configure their authenticated subject in the local server environment and restart the server, then sign in normally. Neither `.env.local` nor OAuth settings were changed here. Current local flags are absent/disabled, so historical review intentionally denies access until this secure opt-in is configured. The route returns not-found for an authenticated non-operator; direct actions/commands reject. No receipt read occurs merely to decide whether access is allowed.

The route still appears in the server build’s route inventory; build inclusion is not authorization. It is a server component with no new diagnostic client dependency or public environment values. Internal capability does not grant another Store’s ownership. Owner business configuration/download services remain separately authorized; the internal gate does not replace their tenancy controls.

## Real Store read-only verification

A local-host-checked, read-only repeatable-read PostgreSQL transaction verified:

- Target has one active exact mapping, pointing to v3 ACTIVE.
- v3 has one section, PDF output, ASSISTED workflow and no pinned title metadata (legacy).
- MRH has zero Orders, lines, Readings, Generations, AI requests, document designs, artifacts and historical adoptions.
- Migration history contains 25 applied migrations.

Only counts/status/metadata-presence were emitted. No customer values, private source identities, credentials or raw receipts were printed. No live API, browser generation or real PDF acceptance is claimed.

## Validation

- **207 unit tests passed:** 204 across 18 source/policy/generation/review/layout/storage/download/internal-access suites, plus 3 runtime wiring tests.
- **254 isolated database tests passed:** 178 across Product, controlled Etsy intake, Generation, document designs/snapshots/artifacts; 76 across production admission/execution/recovery.
- Concrete filesystem adapter tested with synthetic PDF bytes and with the existing isolated fake-generation → approval → renderer → artifact → authorized download pipeline. Replay keeps one artifact; foreign organization/sibling Store downloads fail. No real customer data or provider network calls.
- Required/optional inputs, combined whitespace, 10,000-character valid answer, injection-as-data, exact option identities, legacy prompt compatibility, immutable titles, reader snapshot, design revision pinning and missing/invalid designs covered.
- Production owner-only review access denied; direct action and command denial tested. Local explicit allowlisting and production GitHub-only allowlisting covered.
- `pnpm typecheck`: PASS. Production `pnpm build`: PASS. `git diff --check`: PASS.
- No schema, migration, package or lockfile change. Disposable suites apply existing migrations freshly and include migrator replay/history preservation. Real database migrations were not run.
- Initial validation failures were corrected: canonical macOS temporary path fixtures, test environment typing, and null title lookup for held/unresolved source lines. The final suites pass without weakening holds.
- No interactive browser/manual PDF inspection was performed. Tests do not constitute real Etsy E2E, content-quality, deployment-storage or customer-download acceptance.

## Files changed

- Product/generation: `src/modules/products/contracts.ts`, `service.ts`; `src/modules/generation/contracts.ts`, `context.ts`, `instructions.ts`; `src/modules/etsy/controlled-intake.ts`.
- Review/documents: `src/modules/review/approved-reading.ts`, `service.ts`; `src/modules/documents/service.ts`, `snapshot-contract.ts`, `snapshot-service.ts`, `layout/contract.ts`, `layout/engine.ts`, `download.ts`.
- Storage/runtime: `src/infrastructure/local-artifact-storage.ts`, `document-runtime.ts`; `src/modules/production/runtime.ts`.
- Owner UI/download: `src/app/(operations)/products/[id]/document-design/page.tsx`, `actions.ts`; `src/components/products/editor.tsx`; `src/app/api/readings/[readingId]/artifacts/[artifactId]/route.ts`.
- Internal isolation: `src/modules/identity/internal-access.ts`; `src/modules/etsy/candidate-review.ts`; `src/app/etsy/historical-review/page.tsx`, `actions.ts`.
- New tests: `generation-integration`, `local-artifact-storage`, `internal-access`, `document-download-route`, `document-design-ui`, `document-runtime-wiring` unit suites.
- Extended tests: Product, controlled Etsy, Generation, document design/snapshot/artifact DB suites and historical review UI suite.
- Configuration/docs: `.env.example`, `docs/PRODUCT_CONFIGURATION.md`, this report.

Known generated `next-env.d.ts` / `tsconfig.json` diffs were inspected, preserved and excluded from the commit. No local secrets/artifacts are committed.

## Remaining owner/deployment steps and first-test prerequisites

1. Review and explicitly republish the chosen exact Product configuration to pin its approved title. Do not activate other combinations or rewrite v3.
2. Explicitly create/approve an existing-contract Store design and assign it through the owner page (or established owner command). Confirm DESIGN_READY and fonts/resource compatibility.
3. Configure private local storage for a local test; use a separately configured durable adapter before deployment. Enable exact authenticated internal capability only for authorized operators who need historical review.
4. Privately review one exact fresh purchase/version/fingerprint. Obtain separate historical adoption/ingestion authorization when needed, then use controlled ingestion with production admission suppressed. This milestone supplies no approval.
5. Read-only assemble the real pinned context and verify title, attribution, original mapped answer, scope, English and policy. Review provider privacy, content suitability and budget before separately authorizing one paid Gemini attempt.
6. After generation, inspect quality and explicitly approve. Only then authorize a controlled private PDF render/storage/download test. No Etsy messages or delivery are part of that test.

**Technical integration is tested with isolated fixtures; live MRH Gemini + PDF readiness remains conditional on these explicit steps.** `ETSY-E2E-01`, `ETSY-CARDINALITY-01`, and `ETSY-INPUTS-01` remain OPEN. No real acceptance debt was closed.
