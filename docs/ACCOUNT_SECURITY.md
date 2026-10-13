# Production account authentication

Customer authentication uses the existing Auth.js JWT session system, with separate Argon2id credential identities (`account:<uuid>`). Migration `0032_customer_authentication.sql` follows 0031. Apply through the existing guarded migration procedure only after owner authorization and backup. No native databases were migrated during implementation.

## Required deployment configuration

| Setting | Requirement |
| --- | --- |
| `AUTH_SECRET` | Stable, independently generated high-entropy session encryption secret. |
| `AUTH_CODE_SECRET` | Separate stable random secret, at least 32 characters; shared across application instances. HMAC protects six-digit codes and rate-limit identifiers against offline guessing. Rotation invalidates outstanding codes and existing rate counters. |
| `AUTH_URL` | Canonical public HTTPS application URL. |
| `AUTH_TRUST_HOST` | Enable only behind a trusted proxy which replaces forwarded host/protocol headers. |
| `EMAIL_PROVIDER` | `resend`. Missing configuration fails closed. |
| `RESEND_API_KEY` | Sending API key held in the platform secret store. |
| `EMAIL_FROM` | Sender on a domain verified in Resend. Configure DNS/domain verification and delivery monitoring before registration is enabled. |
| `AUTH_LEGACY_GITHUB_ENABLED` | Default unset/false in production. Optional true enables only existing GitHub identities. |
| `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` | Only needed for optional legacy access, not customer signup/login. |

Resend receives plain-text verification/reset templates containing a purpose-specific six-digit code, ten-minute expiry and ignore-if-unrequested notice. Codes never enter public responses or logs. The provider request has a ten-second timeout, no automatic retry, and challenge-ID idempotency. Delivery failure invalidates the issued challenge. Password-reset delivery is scheduled with Next.js `after()` so public responses do not reveal provider network latency; this is not a durable delivery queue. A killed process can lose delivery; the seller can request another code after 60 seconds. Monitor sanitized delivery-failure messages and Resend's delivery dashboard. No real emails are sent by tests.

## Security policy

- New accounts get a distinct organization/owner membership, but no session or application access before verification. Store onboarding reuses that organization.
- Passwords are 12–128 characters, without silent truncation. Argon2id uses 19 MiB, two iterations and one lane; benchmark capacity on the deployment host.
- Verification/reset codes expire after ten minutes, allow five guesses, and can be used once. Consumption and account mutation share a locked transaction. Resends replace the previous challenge after a 60-second cooldown.
- PostgreSQL-backed fixed-window counters are shared across instances: registration five/address/15 minutes and 200 globally/15 minutes; login ten/address/15 minutes and 1,000 globally/15 minutes; code delivery five/address/purpose/hour and 500 globally/hour; code verification ten/address/purpose/15 minutes and 1,000 globally/15 minutes; reset hashing ten/address/15 minutes and 200 globally/15 minutes; password change five/user/15 minutes. These conservative global limits may affect a busy deployment. No untrusted forwarded-IP header is used as an identity. Infrastructure request/body/concurrency limits remain necessary against distributed abuse.
- Code hashes and counter keys use `AUTH_CODE_SECRET`; the application server is the trusted credential-writing boundary. Database role access must remain private and least-privileged.
- Existing Auth.js CSRF protection and Next.js server-action origin validation remain enabled. Production session cookies are Secure, HttpOnly and SameSite=Lax through Auth.js. HTTPS is required.
- Sessions expire after eight hours. Every Auth.js session read checks the database session epoch and verified status; client session updates cannot replace the epoch. Logout, reset and password change revoke **all sessions including the current session**, requiring a fresh login. Password change also invalidates outstanding reset codes.
- Membership/store authorization and private artifact services remain authoritative. No tenant/store identifiers supplied by password forms are trusted.
- Rate-limit/challenge retention needs an operational housekeeping policy for expired rows; expired records are never eligible for use. Do not run cleanup against a protected database without authorization.

## Historical identity transition

No historical GitHub or development identity is deleted, merged by email, or transferred. Registration encountering an existing email cannot replace its password or ownership. Production legacy GitHub login, if explicitly enabled, accepts only an already existing `github:<provider-id>` user. New production GitHub identities are rejected.

There is deliberately no automated linking/migration endpoint. Until a separately reviewed linking workflow exists, existing GitHub owners should retain explicitly enabled legacy access. A future controlled migration must authenticate the existing identity, verify the new email, prove organization ownership, prevent conflicting credential identities, record an audit trail, and revoke old sessions. Do not manually merge users based on matching emails.

## Verification limits

Isolated PGlite tests and fake email delivery validate service behavior. Deployment HTTPS/proxy/cookies, real-domain delivery, native PostgreSQL migration 0032, Railway capacity and authenticated browser flows require deployment verification. No production-readiness claim is made here.

## Authentication frontend

The five unchanged public URLs live in `(public)/(authentication)`, whose route layout mounts the independent AuthenticationLayout directly beneath the root HTML layout. It does not inherit the dashboard shell. The previous AuthShell is removed, and authentication no longer uses entry.module.css. AuthenticationLayout, contextual header navigation, introduction/showcase components and forms use authentication.module.css as their only presentation source. Settings retains its SecurityForm import via a compatibility re-export; password-change behavior is unchanged.

The header is separate from the two-panel main. Desktop panels have equal minmax(0,1fr) tracks; the left panel centers a 380px container; the right panel fills its track. At 850px and below the showcase is hidden and the form panel occupies the full width. Styling follows the supplied HTML reference without prototype JavaScript, billing or demo social login.

The ten-minute HttpOnly, SameSite=Lax registration cookie carries normalized email only (Secure in production). It grants no authority; verification still validates email and the single-use expiring code server-side. Missing context provides email recovery; Change email changes the challenge target, not account identity. OTP paste, native keyboard navigation, autofill and resend countdown are preserved alongside authoritative database cooldowns. Validated internal login destinations, password-manager autocomplete and matching-password feedback remain intact.

Focused render tests inspect semantic layout structure, route content, contextual header navigation, absence of social login and preserved form fields. The final execution scope excludes browser tests and screenshots; the owner will manually inspect the completed UI. Exact multi-viewport geometry and live authentication delivery remain unverified. No backend security, schema or provider configuration changes are part of this rebuild.

Login uses one full-width outlined Create account navigation action, 16px below the filled Log in action; registration uses the same outlined Back to login action. The previous text footer and its styling are removed. The outlined action matches the primary 46px minimum height and 9px radius, has explicit no-underline states and a focus outline, and disables its 150ms transitions for reduced motion; login and registration headers retain only the brand to avoid duplicate account navigation. Verification is reached from registration or a password-validated unverified login, rather than a permanent login link. The existing rate-limited credential check can emit a server-only UnverifiedLogin signal after a valid password; Auth.js still denies the session, and the server action carries normalized email in the existing HttpOnly cookie before redirecting to verification. Incorrect credentials and unknown emails remain generic. Resume does not send email automatically; the existing rate-limited resend action remains available on the verification page. Hashing, limits, OTP rules and session callbacks are unchanged.
