# Document / PDF Engine — Part 2.5A report

Starting commit: `229cebdb836acb46753f0ac9be2348cbe8ad7133`.
Branch: `codex/ui-ux-design-lock`. Starting working tree was clean; required base was HEAD and in history. Ending commit is the commit containing this report, reported by SHA in the final response (a commit cannot embed its own SHA). No push or deployment.

## Implementation inventory

| Files | Responsibility |
| --- | --- |
| `src/modules/media/catalog.ts` | Code-owned canonical 78-card tuple catalog and orientation |
| `src/modules/media/contracts.ts` | Strict bounded contracts, immutable detached values, manifest hash and validation |
| `src/modules/media/service.ts` | Exact card asset, seller-safe catalog, verified byte reads and owned Store preferences |
| `src/modules/media/platform-registry.ts` | Trusted offline platform registration/publication/retirement; no seller endpoint |
| `src/infrastructure/object-storage.ts` | Narrow platform namespace read port beside the existing private-storage port |
| `src/db/schema.ts` | Four additive platform/Store tables |
| `drizzle/0018_eminent_human_torch.sql` | Additive tables, ownership FKs, completeness/rights/revision/retention guards |
| `drizzle/meta/0018_snapshot.json`, `drizzle/meta/_journal.json` | Generated schema snapshot and migration journal |
| `tests/media.fixture.ts` | Explicitly synthetic bytes, assets and manifests only |
| `tests/media.test.ts` | 36 focused unit cases |
| `tests/media.db.test.ts` | 12 focused database cases, including replay/preservation/concurrency/corruption |
| `docs/READING_MEDIA.md`, this report | Architecture, policies, validation and future boundaries |

## Domain decisions and requested outcomes

1. **Media/assets boundary:** independent `src/modules/media`; no Reading, customer, provider, AI, Review or billing imports/data.
2. **Canonical catalog:** code-owned, immutable 78 entries: 22 Major and 56 Minor. Stable explicit Major keys and RANK_OF_SUIT Minor keys; display labels never identify cards.
3. **Ordering:** Major 0–21, then WANDS/CUPS/SWORDS/PENTACLES, each ACE through KING. Strength 8 and Justice 11; JUDGEMENT is the explicit canonical spelling. Tuple validation includes key/arcana/suit/rank/order/label. SQL canonical key completeness is tested against the code catalog.
4. **Orientation:** exactly UPRIGHT/REVERSED, semantically separate from artwork; no Reading assignments.
5. **Platform asset:** immutable UUID, unique object key and strict metadata: kind, MIME, bytes, SHA-256, dimensions, lifecycle, controlled provenance/rights and creation time.
6. **Storage:** existing object-storage module gains only `PlatformAssetStorage.read`; future S3-compatible hosting remains unimplemented. No AWS SDK, new dependency, cloud adapter, upload or presigned flow.
7. **Integrity:** stable SHA-256 digest identifies exact bytes independently of UUID. Trusted retrieval resolves durable identity and checks length/digest against bytes from an injected storage adapter.
8. **Replacement:** SQL forbids all asset mutation/deletion. New bytes require a new UUID/object key and changed deck version. Historical object overwrite fails digest verification. Future adapters must enforce write-once retention.
9. **MIME/bounds:** PNG/JPEG/WebP only. 1–25 MiB; 1–16384 dimensions; ≤100 million pixels; broad ratio sanity bound rather than fixed physical card ratio. Object keys max 512 in controlled platform namespace. No SVG/HTML/public/data URL support.
10. **Deck:** immutable platform key/display name/description, no tenant columns or deck-count cap.
11. **Version:** composite key/version and DRAFT/PUBLISHED/RETIRED atomic JSON manifest. Staging is offline only; a complete newly published manifest is the operator runtime path.
12. **Publication/selectability:** only complete approved PUBLISHED versions are seller-selectable; one PUBLISHED version per stable deck. Approved assets and deck rights independently required.
13. **Completeness:** exactly 78 known keys once each, all valid existing usable image assets; 77/79, duplicate/unknown/missing/unusable mappings rejected. Sharing one synthetic asset across keys is allowed; completeness does not invent artwork uniqueness requirements.
14. **Mapping persistence:** version-owned `{cardKey, assetId}` manifest entries rather than a mutable mapping table. `mappingHash` uses existing stable JSON + SHA-256. Published semantics are immutable; SQL validates canonical completeness/asset references and forbids destructive historical changes.
15. **Exact resolution:** `resolveTarotCardAsset` validates the entire version/assets before returning one detached deeply frozen `tarot-card-asset/v1` with exact deck/version/card and asset UUID/digest/MIME/bytes/dimensions.
16. **Seller catalog:** authenticated `listSelectableTarotDecks` returns only key/name/exact selectable version/description. Object keys, credentials, legal notes/evidence, internal status and raw rows are excluded.
17. **Rights/provenance:** UNVERIFIED/APPROVED/RESTRICTED state; controlled classification, bounded source/evidence/internal notes. Approval requires evidence/non-UNVERIFIED classification. No license is fabricated and no legal status is asserted for real artwork.
18. **Real artwork:** none imported, scraped, downloaded, seeded or committed. Synthetic integrity bytes are not a real deck or renderable commercial asset.
19. **Store preference:** unique organization/Store-owned exact deck/version relationship with composite owned Store FK and exact version FK.
20. **Missing preference:** explicit NOT_CONFIGURED/revision 0. No catalog-first fallback, historical backfill or invented default.
21. **Updates:** expectedRevision, initial 1, monotonic increments, current-revision identical write no-op, stale conflict. Structural corruption cannot be repaired by overwriting through this boundary.
22. **Retirement:** PUBLISHED → RETIRED is terminal and removes new selectability. Existing preference reads fail safely until explicit reselection with the known revision; no fallback or automatic migration. Published maps/assets are retained.
23. **Historical reads:** exact retired versions continue resolving approved retained assets; no latest-version substitution. No current Store preference participates in historical card reads.
24. **Ownership/security:** platform tables are global, preferences alone are tenant/Store-owned. Verified scope/owner rules prevent cross-org or forged Store reads/writes; sibling scopes see only their own preference and cannot supply another target Store. No seller catalog mutation API or route exists.
25. **Concurrency:** Store-first lock serializes preference mutations; exact version share lock and SQL guard protect selectable state through commit. Retirement uses exclusive version lock; publication serializes on the deck. Either a coherent preference commits or a safe failure/conflict occurs. No distributed locks.
26. **Corruption:** strict commands, durable identity consistency, bounded contracts, rights, lifecycle, completeness and digest checks fail closed; no silent repair/substitution. Seller catalog fails when an entry claiming selectability is corrupt.
27. **Readonly:** metadata read boundaries are detached and deeply frozen, with readonly types. The trusted storage binary read returns a detached Uint8Array; populated typed arrays cannot be frozen by JavaScript. Persistence rows/storage metadata are not renderer contracts.
28. **Product extension:** a later owned Product override can reference the same exact deck/version and resolve override → Store preference without altering ProductVersion or canonical media semantics.
29. **Entitlement extension:** a later capability decision can authorize Store use independent of named plans and standard/custom subscriptions. No pricing, billing or entitlement implementation.
30. **Tables:** `platform_assets`, `tarot_decks`, `tarot_deck_versions`, `store_tarot_preferences`. No separate mapping table or duplicate storage architecture.
31. **Migration:** additive 0018, no data seeds/backfills or existing-table changes. Replay from scratch, runner repeat/no-op and populated pre-media table preservation are covered. Generation/Review/Design/Snapshot history is untouched.
32. **Generation:** unchanged; no schema/prompt/output card integration and no gateway/provider/accounting changes.
33. **Review:** unchanged; approved-reading/v1, drafts and approval UI unchanged.
34. **Snapshots:** document-snapshot/v1 code and hash semantics unchanged; no media field, v2 or preference integration.
35. **Renderer/frontend:** no renderer, layout, pagination, preview, PDF/artifact, reversed transform, seller deck selector or other frontend change.
36. **Future boundary:** Part 2.5B owns Reading cards/orientations, exact media pinning and media/snapshot contract evolution. Part 3 owns layout and rendering. See READING_MEDIA.md for the pipeline and policies.

PART 2.5A DOES NOT ADD TAROT CARDS TO GENERATED READINGS.

PART 2.5A DOES NOT MODIFY DOCUMENT SNAPSHOT SEMANTICS.

PART 2.5A DOES NOT RENDER A PDF.

## Validation

Runtime: Node 22.23.1, pnpm 9.7.1. Initial shell default was Node 20; supported Node 22 was explicitly selected for final validation.

- `pnpm typecheck`: PASS, including after restoring inspected Next.js tooling noise.
- `pnpm test`: PASS — **219 unit tests**, 29 files (36 added here).
- `pnpm test:db`: PASS — **305 database tests**, 14 files (12 added here).
- **Total: 524 passing tests**; 48 focused media tests added (36 unit + 12 DB).
- `pnpm build`: PASS. Only generated `next-env.d.ts` imports/comments and `tsconfig.json` formatting/allowJs/dev-types additions were inspected then restored; no frontend source changed.
- `git diff --check`: PASS.
- `pnpm db:generate`: **No schema changes, nothing to migrate**; no drift.
- Migration replay from scratch, repeat/no-op and populated pre-media fixture preservation: PASS in focused DB suite. The preservation test snapshots all existing public-table rows before 0018 and compares them after it.
- Focused tests cover canonical identity/orientation, metadata/hash/MIME/dimension/size bounds, URL rejection, whole-deck validity and exact resolution, rights/staging, platform immutability/versioning, safe catalog/storage integrity, Store preferences/auth/concurrency, retirement/history, corruption, frozen contracts and migration behavior. Existing Document Parts 1/2, Review, Generation, Production and Style tests are included in the regression runs.
- **Real Gemini calls = 0.** No web service/asset sourcing, push or deployment was performed.

Native PostgreSQL verification limitation: local `initdb` was attempted but sandbox shared-memory creation failed (`shmget: Operation not permitted`). DB verification uses PGlite. Overlapping-command tests establish the application outcomes on that serialized engine; they do not demonstrate native multi-connection lock timing. A later authorized host check can verify that timing without modifying the domain.

Final committed git status is reported in the task response.
