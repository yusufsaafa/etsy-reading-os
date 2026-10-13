# Private S3-compatible PDF storage (Cloudflare R2 / Railway)

## Implemented architecture

The existing PostgreSQL document pipeline persists immutable PENDING artifact evidence, performs conditional private object creation, verifies bytes, then marks the same artifact AVAILABLE. `S3ArtifactStorage` implements the existing `ImmutableArtifactStorage` port with AWS SDK for JavaScript v3. Renderer, artifact schema, review approval, manual delivery semantics and PostgreSQL leases are unchanged. No storage migration is required.

Railway web and generation/PDF worker use the same PostgreSQL, bucket, endpoint, region and prefix. Each deployment retains its packaged renderer fonts/platform artwork. PDF persistence requires no shared POSIX volume. The persistent-volume and local-development adapters remain available; there is no silent fallback between drivers.

Authenticated preview/download still resolves organization/store/Reading ownership before remote access, fetches bytes server-side and checks expected MIME, byte length and SHA-256. Existing private response, safe filename, Content-Disposition, no-store and security headers are unchanged. Browser responses contain neither remote keys nor credentials. No presigned/public download URLs are issued.

## Required configuration (both services)

| Variable | Value / requirement |
| --- | --- |
| `DOCUMENT_STORAGE_DRIVER` | `s3-compatible` |
| `S3_ENDPOINT` | Account-specific HTTPS S3 endpoint, e.g. `https://<account-id>.r2.cloudflarestorage.com`. No embedded credentials, path, query or fragment. |
| `S3_BUCKET` | Existing private bucket name. Adapter never creates a bucket. |
| `S3_REGION` | `auto` for R2; explicit provider-supported region elsewhere. |
| `S3_ACCESS_KEY_ID` | Dedicated bucket-scoped S3 access key, managed as a Railway secret. |
| `S3_SECRET_ACCESS_KEY` | Matching secret, managed as a Railway secret. |
| `S3_KEY_PREFIX` | Optional fixed generic namespace such as `reading-os`; no leading/trailing slash, traversal, PII or customer identifiers. Maximum 128 characters. |
| `S3_CONDITIONAL_WRITES_CONFIRMED` | `true` only after the isolated provider-specific conditional-write checks below. Missing/false refuses activation. This is an owner attestation, not an automated capability probe. |

Next.js instrumentation validates selected S3 configuration at Node startup without connecting to storage or PostgreSQL. Worker launch validates it before connecting to PostgreSQL. `S3_CONFIGURED` indicates valid configuration only, not bucket reachability or successful credential validation. Actual operations fail closed on authorization/network/bucket errors. Existing `DOCUMENT_ASSET_ROOT` remains independent read-only platform artwork configuration; `DOCUMENT_ARTIFACT_ROOT` is not used by this driver.

## Cloudflare R2 setup (owner actions; not performed)

1. Create/select a dedicated **private** bucket through the Cloudflare dashboard. Disable r2.dev/public access and public custom domains. Do not enable automatic bucket creation headers. No browser CORS policy is needed because only the servers access R2.
2. Create dedicated bucket-scoped object read/write credentials. If supported by your permission model, give web read-only credentials and the worker read/write credentials for the same namespace. No application API performs deletion/listing/bucket creation. Verify the chosen R2 permission granularity; do not assume write credentials are incapable of deletion.
3. Set the variables in both Railway services using shared configuration references where suitable. Do not put secrets in the repository or client-exposed environment variables.
4. Pin a compatible Node >=22.12 runtime and install the lockfile dependencies. Build with `pnpm build`; set the Railway web start command to `pnpm exec next start --hostname 0.0.0.0 --port "$PORT"`. Run the existing `pnpm worker:production` separately with its existing explicit worker/AI/budget configuration; do not start duplicate generic workers.
5. Complete the isolated-object checks below before setting the conditional-write attestation true for application traffic.

## Integrity, immutability and retry behavior

Logical keys remain `private/documents/v1/<organization UUID>/<store UUID>/<Reading UUID>/<media snapshot UUID>/reading-pdf-1/<SHA-256>.pdf`; the optional prefix affects physical placement only. Keys contain no customer names/emails/personalization. Ownership/key shape is checked before any provider operation.

The adapter issues one non-multipart `PutObject` with `If-None-Match: *`, exact Content-Type/Content-Length and private identity/hash/length metadata. There is no ACL/public URL option, unconditional replacement, HEAD-then-overwrite, or delete capability. The SDK has `maxAttempts: 1`; the existing PostgreSQL production worker owns bounded retries. Optional SDK checksums are set to WHEN_REQUIRED for compatibility; ETag/provider checksums are not accepted as SHA-256 proof.

After upload acknowledgement, a full bounded GET checks metadata, MIME, stream length, PDF signature and SHA-256. On 409/412 conditional conflict, the exact existing object is read and verified; matching evidence is idempotent success and differing/corrupt evidence is CONFLICT. No replacement is attempted. Logical keys pin all immutable source identities; layout/resource hashes remain in the existing immutable database artifact record.

PUT and GET each have a 30-second deadline. Streaming GET enforces the declared length and caller bound before collecting an unbounded object, and aborts/destroys failed streams. The overall create-plus-readback operation can take up to approximately two deadlines. PDF size remains bounded by the existing 128 MiB renderer contract. Capacity and latency must be measured on Railway.

Network/upload timeout may mean an object was written despite a lost acknowledgement. The adapter reports a sanitized UNAVAILABLE and never assumes that absence after a timeout proves no later commit. Existing durable PENDING evidence lets restart/retry read and adopt an exact object, or repeat the same conditional creation safely. Database finalization failure similarly retains one pending intent and one immutable remote object. Changing namespace/credentials to bypass a conflict is not recovery.

## Failures and recovery

- Invalid/missing configuration: startup refuses the selected driver; correct configuration without switching silently to local storage.
- Invalid credentials/missing bucket/network interruption: UNAVAILABLE; verify permissions/endpoint and use the existing bounded work retry/recovery path.
- Exact `NoSuchKey`: MISSING; bucket failures are not treated as missing objects.
- Invalid metadata, corrupt/truncated/oversized bytes: INTEGRITY/LIMIT; never serve or silently overwrite. Investigate and restore the exact historical object from an independently verified backup.
- Conflicting existing object: CONFLICT; preserve evidence, stop that work and investigate.
- Upload succeeded but DB settlement failed: retry the existing pending artifact; do not create another Reading or artifact identity.

Provider exception bodies, endpoint details, keys and credentials are not propagated to UI/logging by this adapter. Existing seller-facing error handling remains in use. Observe sanitized work failure codes plus provider-side operational monitoring.

## Provider-specific assumptions and live verification requirements

Cloudflare documents S3 PutObject conditional operations and If-None-Match support, but API compatibility alone is not proof of deployed behavior. Other S3-compatible providers may differ. No real bucket was accessed during implementation.

Before activation, use a separately authorized isolated **non-customer** object and verify:

- Bucket is inaccessible without credentials; public endpoints/custom domains are disabled.
- First conditional create succeeds. A second conflicting conditional create returns 412/409 and preserves the first bytes and metadata.
- Concurrent creates admit one winner; identical replay verifies that same object. Verify this across two independently configured Railway processes.
- Failed/unsupported conditional headers are rejected; there is no successful unconditional fallback. Do not set the attestation for a provider that ignores the condition.
- Full GET returns exact MIME, length and custom metadata; corrupted evidence is rejected. ETag is not the artifact digest.
- Network interruption/ambiguous upload and restart adopt the same artifact; delayed writes cannot overwrite another winner.
- Both services access the same namespace with intended least-privilege credentials. Server-only authorized preview/download preserves no-store and security headers.
- Measure maximum expected PDF upload/readback latency, memory usage and worker lease behavior; verify worker and web network access to R2.

## Backup and retention

R2 object durability is not a complete backup strategy. Maintain independently recoverable PostgreSQL backups and private object backups/inventory retaining exact keys, metadata and bytes. Protect backup credentials and test restoration together; an artifact row without its object is unavailable. Choose retention/lifecycle rules that do not expire referenced customer artifacts. Do not assume R2 provides S3 Object Lock/versioning semantics. The adapter prevents application overwrites; a bucket administrator or broader write credential can still modify/delete objects. Coordinate any retention/deletion policy separately; this adapter has no automatic destructive cleanup.

## Automated evidence

Fake SDK/transport tests cover conditional create/read, exact replay, concurrent creation, conflict, corruption, missing object/bucket/credentials, timeouts, configuration guards and restart recovery. Existing local/persistent-volume compatibility tests remain. Isolated PGlite integration covers upload uncertainty, cross-tenant denial before S3 reads and database-finalization recovery. These do not constitute live R2 or Railway acceptance.

Primary references:
- https://developers.cloudflare.com/r2/api/s3/api/
- https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html

**Implementation/testing are local. R2 provisioning, credential/privacy verification, native deployment and live acceptance remain owner/deployment requirements.**

Local verification commands: `pnpm test tests/s3-artifact-storage.test.ts tests/local-artifact-storage.test.ts tests/document-runtime-wiring.test.ts tests/production-launch.test.ts tests/generation-setup-status.test.ts` (45 passing); `pnpm test:db tests/document-artifact.db.test.ts -t "S3 artifacts|S3 upload"` (2 passing in isolated PGlite). Typecheck, production build and diff check are also required.

## Files changed for this storage task

Created: `src/infrastructure/s3-artifact-storage.ts`, `src/instrumentation.ts`, `tests/s3-artifact-storage.test.ts`, `tests/s3-storage.fixture.ts`, and this guide.

Updated: `package.json`, `pnpm-lock.yaml`, `src/infrastructure/document-runtime.ts`, `scripts/production-worker.ts`, `src/components/review/pdf-panel.tsx`, `src/modules/products/generation-setup.ts`, `src/components/products/generation-setup-status.tsx`, `tests/document-artifact.db.test.ts`, `tests/production-launch.test.ts`, and `docs/PRODUCTION_LAUNCH_PHASE1.md`. Existing authentication work and migration 0032 remain preserved. Storage adds no schema migration.

Switching drivers does **not** copy existing PDFs. If referenced artifacts already exist in local/persistent-volume storage, retain the previous driver until a separately authorized copy has been validated. Copy validated PDF bytes through the existing immutable ports with the same logical identity; never upload a local envelope as raw PDF or rewrite immutable database identities. No automatic object migration tool is implemented here.
