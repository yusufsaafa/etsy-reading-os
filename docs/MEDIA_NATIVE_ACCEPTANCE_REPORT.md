# MEDIA-NATIVE-01 native acceptance

Date: 2026-10-07 (Europe/Istanbul). Starting commit: `33455f660cc674d114a442676043fe95c2332c40`, branch `codex/ui-ux-design-lock`. Decision: **ACCEPTED** after actual native repeated execution.

## Environment and repeat command

Local Homebrew PostgreSQL **16.14**, aarch64-apple-darwin25.4.0, loopback port 5432. Native server used successfully; no remote DB, application environment file or production credentials. Each test creates a randomly named `mrh_native_*` disposable database, applies the actual migrations and drops it after closing connections. Connection options explicitly select the local OS role, empty password and no SSL; inherited PG credentials are not used. Local OS authentication requires permission to create/drop databases; synthetic corruption fixtures additionally require session_replication_role. Never run this harness against another database.

Node **22.23.1**, `/Users/yusufsafakilic/.nvm/versions/node/v22.23.1/bin/node`; `postgres` **3.4.7**, `drizzle-orm/postgres-js` **0.45.2**, Vitest **4.1.11**. Run `pnpm exec vitest run --config vitest.native.config.ts` under Node 22. The acceptance config substitutes only the existing tests' PGlite construction/Drizzle imports with the native acceptance adapter and native migrator. No PGlite engine is used by that command. Normal pnpm test/test:db still use their original configuration.

Barrier fixtures use **six independent PostgreSQL connections**: five pooled application connections plus one dedicated raw/observer connection. Four simultaneously reserved connections assert distinct pg_backend_pid values and READ COMMITTED. The design contention test observes four separate lock waiters while a fifth connection holds Store, and the sixth observes pg_stat_activity. The stale-worker scenario additionally creates two separate max=1 driver clients and asserts distinct backend PIDs for worker A and B; total fixture capacity is up to eight connections. Raw BEGIN/COMMIT fixture commands use a dedicated single connection. Disposable database administration uses a separate short-lived connection outside scenario execution.

Application transactions use READ COMMITTED; historical resolution explicitly uses REPEATABLE READ. Real Store FOR UPDATE, deck-version FOR SHARE/UPDATE, work/artifact row locks and SQL uniqueness/triggers are exercised. Statement timeout 15 seconds, lock timeout 10 seconds, lock-observation deadline 5 seconds, test/hook timeout 30 seconds. Synchronization uses transaction/storage barriers; 10ms polling only observes real lock waiters and does not decide operation order by sleeping.

## Scenarios

| Case | Native evidence |
|---|---|
| A: duplicate document/media | Two creators blocked concurrently on Store, then one exact snapshot/media ID, one logical row each; concurrent approval replay preserves provenance. |
| B: preference | Pinned creation holds Store; preference waits, commits after pinning; historical cards remain exact. Competing same expectedRevision commands yield one commit and one explicit conflict. |
| C: deck lifecycle | Pinned creation holds version share lock; retirement waits and then succeeds; historical evidence remains readable without fallback. Existing race also covers creation versus retirement and safe failures. |
| Publication | An uncommitted published version cannot be selected; selection leaves no preference row. After publication commits, exact version selection succeeds. |
| D: review/design | Approval replay, duplicate input, revision/default/Product assignment contention use the same Store lock; stale design revisions conflict safely, successful frozen input remains historically readable. |
| E: artifacts | Duplicate render producers converge to one intent/object. Two claim workers are observed simultaneously waiting on Store; one completes and one logical AVAILABLE artifact exists. |
| F/I: fencing | Native durable claim tokens, overlapping workers, database-clock expiry fixture and delayed storage worker: replacement claim completes; late old worker returns SUPERSEDED, cannot overwrite settlement. |
| G: finalization crash boundary | Injected DB finalization trigger failure rolls back AVAILABLE after durable PENDING/object; removing failure and retry adopts same ID/object, one write. Expired worker path adopts written object. |
| H: ambiguous write | Fake write succeeds but reports UNAVAILABLE; retry verifies existing bytes and adopts pending intent without rewrite. Production retry retains pinned input and uses durable bounded backoff. |
| J: bounded lock behavior | Actual lock waiters, barriers and repeated contention complete or return expected domain conflicts; no observed deadlock or indefinite blocking in accepted runs. This is empirical evidence, not proof of universal deadlock freedom. |
| Integrity/history | SQL immutability, ownership, retrieval corruption, design/deck retirement preservation, actual deterministic PDF integration, migration fresh/replay/history all pass natively. |

Crash cases simulate interruption/finalization failure through real committed/rolled-back PostgreSQL transactions and fake immutable storage; they do not kill a PostgreSQL server or test power loss. Claim expiration advances the persisted deadline through a synthetic privileged fixture rather than waiting 15 minutes. Stored bytes are synthetic and the actual deterministic renderer is used; this does not accept real artwork/PDF host/storage debts.

## Results and review

Final unchanged harness: **three complete runs, 82/82 passed each (246 executions), zero failures**. Durations: 36.53s, 33.78s, 31.31s. Seven synchronized scenario families each run five iterations: **15 iterations per family** across final runs. Existing duplicate artifact, crash/ambiguous-write/finalization, expiry/fencing, historical and migration regressions run three times each. Identity/isolation assertions pass in every run. No observed deadlock, timeout, duplicate AVAILABLE artifact, mutable replacement or hybrid historical evidence. Machine-readable sanitized result summary: tests/native/acceptance-evidence.json.

MEDIA-NATIVE-01 changes OPEN → ACCEPTED. Every other acceptance status is unchanged. All disposable acceptance databases, including draft-run leftovers, were removed after execution.

Initial harness runs exposed raw JSON parameter double serialization by the native driver adapter (four fixture failures). Corrected only the acceptance raw-query serializer to retain already serialized JSON. Additional draft scenarios incorrectly expected stale design updates to succeed and attempted a second selectable version of one deck; the existing architecture correctly rejected both. Harness now asserts safe revision conflicts and publishes a separate deck. One draft publication run was interrupted after its setup error left a barrier waiting; final barrier also awaits transaction failure. A draft claim-contention case used a TEXT fixture, correctly admitting no PDF work; its lock-wait expectation failed in five iterations. The dedicated native fixture now uses PDF output. That draft repeated run was interrupted and is not acceptance evidence. These were harness issues, not discovered production defects. No intermittent acceptance failure is omitted; final repeated results are the decision evidence.

No production code/schema/migration/rendering changes. No new architecture. Native adapter/harness, configuration and evidence documentation only. Focused regressions: 18 artifact unit tests and 46 media/artifact PGlite DB tests passed. Typecheck and git diff check passed. Broader full suites/build/schema generation are not required because production/schema code is unchanged.

Only MEDIA-NATIVE-01 is eligible for closure. PDF-REAL-01, TAROT-ASSETS-01, ETSY-E2E-01, ETSY-CARDINALITY-01 remain MRH backend blockers. STORAGE-REAL-01, ETSY-DELIVERY-01 and AI-CONFIG-01 remain production-launch debts. REVIEW-CARDS-UI-01 remains open; GEMINI-TAROT-01 remains accepted. Backend acceptance precedes Final Seller UI, then MRH Seller Pilot with manual delivery, then Delivery/Telegram/Billing/Production Hardening.

Real Gemini calls = 0; real Etsy calls = 0; real tarot artwork = 0; production storage credentials = 0. No push/deployment. Test memory storage does not prove real object-store conditional semantics, retention or distribution. This acceptance applies to exercised PostgreSQL 16.14 paths and bounded repetitions, not other runtimes, versions, arbitrary workload or mathematical deadlock freedom.
