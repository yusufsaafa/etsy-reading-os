# Etsy real acceptance — blocked at authorization

Date: 2026-10-07 (Europe/Istanbul). Starting HEAD: fdd7572b3624b17e6714484900283cacd40bcec1. Branch: codex/ui-ux-design-lock; preflight clean, required ancestor verified.

**ETSY-E2E-01: OPEN. ETSY-CARDINALITY-01: OPEN.** No real authorization, shop verification, receipt fetch, payload capture, replay, quantity/mixed-cart observation or real-derived persistence occurred. Real receipts exercised = 0, replay count = 0; new acceptance Orders/lines/Readings/production admissions = 0. No contract-derived quantity mutation was made because there is no captured real contract. Local connection inventory was read only, with aggregate booleans/statuses rather than tokens, identities or buyer data.

## Official contract audit

Official sources consulted on this date (documentation evidence only, not live acceptance):

- [Authentication](https://developers.etsy.com/documentation/essentials/authentication/): authorization code + S256 PKCE, exact registered HTTPS redirect, single-use state, token exchange/refresh and returned scope/expiry. API-key authentication uses keystring:shared-secret; private endpoints additionally require bearer authorization. Existing oauth.ts/connection-service.ts match these documented basics and request listings_r/transactions_r, without write scopes. No live token exchange or refresh tested.
- [Reference](https://developers.etsy.com/documentation/reference/): official indexed content confirms shop receipt reads with transactions_r and receipt transaction endpoints, numeric receipt/shop/listing identifiers, limit/offset pagination (maximum 100 for the retrieved list specification), and receipt created/modified filters including was_paid. Full current reference response schema was not retrievable through the rendered documentation in this run. Exact shop lookup response, paid/completed/cancellation/refund fields, receipt/transaction quantities/identifiers, transaction completeness and pagination termination remain unverified against a real payload/current complete specification. Do not infer eligibility from completed/shipped status or substitute a payment-ledger entry for a receipt.
- [Webhooks](https://developers.etsy.com/documentation/essentials/webhooks/): order.paid is documented, with order.canceled/shipped/delivered; notifications supply event_type/resource_url/shop_id. Signing uses exact raw body with webhook-id/timestamp, HMAC-SHA256 and decoded signing secret; the guide illustrates a 300-second freshness margin. Delivery retry and dashboard subscription management are documented. A paid notification is a receipt-fetch trigger, not the full purchased line payload. No app subscription, signature delivery or event receipt tested. Webhooks exist; their availability is not invented or assumed absent.
- [Personalization migration](https://developers.etsy.com/documentation/tutorials/personalization-migration/): listing associations use includes=personalization or dedicated personalization GET. Transaction variations can contain multiple property_id=54 entries with seller-configured formatted_name and upload URLs. Legacy listing personalization fields are no longer returned. Never assume one answer or a fixed English label; do not fetch upload URLs automatically.

## Implementation audit and implications

Store ownership uses Organization/Store plus server-resolved Etsy shop identity. OAuth state is bound to user/tenant/Store, encrypted and single-use; authorization completion validates token-prefix owner against returned shop owner. Existing local vault configuration is present. No secrets were printed or persisted in evidence.

There is **no implemented raw Etsy receipt/listing normalization adapter**: UnverifiedLiveIntakeAdapter explicitly throws LIVE_INTAKE_CONTRACT_NOT_VERIFIED. PostgresSyncJobs.enqueueSync also deliberately rejects non-fixture Stores. There is no public webhook receiver/subscription implementation. Existing sync/adapter ports can support controlled reads, but architecture documentation describing paginated reads is a target boundary, not a working live adapter. OAuth consent alone cannot complete E2E through those gates. No new polling/event infrastructure or gate bypass was added. This is an implementation prerequisite, not a defect demonstrated by live Etsy behavior or a fundamental API invalidation.

The canonical contract expects receipt externalId, line externalId (intended transaction ID), listingId, quantity, timestamps, explicit paid/canceled/refund, variations and answers. Numeric external IDs are strings; duplicate line IDs are rejected. Ingest locks Store, validates tenant/optional connection epoch, upserts one owned Order, inserts unique owned transaction lines, expands stored quantity through unique line/unitIndex identities and preserves purchased snapshots. Older observations are ignored; cancellation/refund evidence is retained conservatively; changed/missing lines raise source drift instead of deleting history. Product resolution pins production configuration; unmapped/unknown variants and missing/unsupported context hold explicitly. Quantity >1 creates units but requires seller context allocation before production; mixed lines resolve independently. Existing production admission runs within receipt transaction under its existing eligibility rules. These behaviors passed synthetic regression only, not real cardinality acceptance.

## Exact authorization boundary / continuation

Configuration is ETSY_ADAPTER=fixtures and ETSY_LIVE_OAUTH_ENABLED=false. ETSY_CLIENT_ID, ETSY_SHARED_SECRET and ETSY_REDIRECT_URI are absent. Aggregate local DB inventory: one fixture Store, disconnected, no encrypted tokens, no external shop identity. No existing usable MRH grant exists in this configured database. No authorization or real Etsy API call was attempted.

Required owner/operator setup, keeping secret values outside chat/git:

1. Supply an approved Etsy app keystring/shared secret in local server configuration. Set ETSY_ADAPTER=etsy and ETSY_LIVE_OAUTH_ENABLED=true. Retain the existing SECRET_ENCRYPTION_KEY/key ID; no rotation/revocation is needed.
2. Provide and register the exact HTTPS callback ending **/api/etsy/callback**, then set ETSY_REDIRECT_URI to that exact URL. An HTTPS origin has not been supplied; http://localhost:3000/api/etsy/callback is not a valid registered HTTPS redirect. Do not claim a tunnel/deployment already exists. Callback auth session and APP_URL must be compatible with the chosen origin.
3. Restart the local app with `pnpm dev` under Node 22. Sign in, create/select an owner-authorized **etsy-source** Store through existing setup (do not change the fixture Store's provenance), and use **http://localhost:3000/onboarding/etsy → Connect Etsy** in the compatible session. The existing callback route is src/app/api/etsy/callback/route.ts. MRH's owner must consent on Etsy using the minimal existing read scopes.
4. After consent, verify shop ownership with read-only API calls, obtain current complete schemas and sanitized real receipt/transaction evidence, then determine the minimal verified adapter integration required by the existing gated ports. Do not automatically turn off the gate before verification. Exercise legitimate existing paid receipts and isolated local persistence/replays; require qualifying real quantity/mixed-cart evidence for closure. No paid webhook event evidence is claimed from a historical receipt fetch.

Stop here pending these authorization prerequisites. No Etsy mutation, account credentials request in chat, Product mapping fabrication or new frontend work was performed.

## Validation and decision

Focused `vitest run tests/intake.test.ts`: **9 passed**. Focused DB `vitest run --config vitest.db.config.ts tests/intake.db.test.ts`: **12 passed** (PGlite/synthetic). `pnpm typecheck`: PASS. `git diff --check`: PASS. Production code/schema/migrations unchanged; full suites/build/schema generation not required. No discovered real API defect or production fix. No raw buyer fixture/log/env file committed.

Both debts remain OPEN — BLOCKS MRH PILOT. MEDIA-NATIVE-01 and GEMINI-TAROT-01 remain ACCEPTED; every other status unchanged. Remaining backend blockers: these two Etsy debts, PDF-REAL-01 and TAROT-ASSETS-01. Backend acceptance still precedes Final Seller UI and MRH Seller Pilot.

Etsy mutations = 0; real Etsy API calls = 0; Gemini calls = 0; real artwork = 0; production storage credentials = 0. No push/deployment. This commit records a blocked acceptance audit, not successful real Etsy acceptance.
