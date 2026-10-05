# Etsy integration: verified capabilities and gates

Verification date: 2026-10-05. Sources are official Etsy documentation only. "Documented" is not a live integration test or evidence that this app has been approved.

## Capability matrix

| Requirement | Evidence | Milestone behavior |
| --- | --- | --- |
| Authorization | [Authentication](https://developers.etsy.com/documentation/essentials/authentication/): authorization-code flow, S256 PKCE, registered HTTPS redirect | Single-use state bound to application user/store, encrypted verifier, server-only exchange |
| Refresh | Same authentication guide documents refresh_token grant and token response, with scoped authorization | Persist expiry from response and returned refresh token; serialize refresh; ambiguous refresh holds for reconnect |
| Shop identity | [Reference](https://developers.etsy.com/documentation/reference/#operation/getShopByOwnerUserId): GET /v3/application/users/{user_id}/shops | Derive external user identity server-side from authorized token prefix and verify returned owner/shop; never accept browser shop ownership |
| Listing import | [Personalization guide](https://developers.etsy.com/documentation/tutorials/personalization-migration/): GET /v3/application/shops/{shop_id}/listings with includes=personalization | Adapter boundary with validated response. Exact listing-state/offer/inventory shapes require approved-app contract testing |
| Order import | [Reference](https://developers.etsy.com/documentation/reference/#operation/getShopReceipts): GET /v3/application/shops/{shop_id}/receipts; transactions_r; limit/offset and created/modified filters | Paginated read adapter; freeze import window, receipt-atomic persistence, replay-safe identifiers |
| Transaction import | [Reference](https://developers.etsy.com/documentation/reference/#operation/getShopReceiptTransactionsByReceipt): receipt transaction endpoint, transactions_r | Receipt must contain a complete transaction set; incomplete/unsupported response fails safely |
| Personalization | Personalization guide documents multiple answers within transaction variations and upload URLs | Preserve raw variations and all personalization entries; no hard-coded English label; URL answers are not downloaded automatically |
| Webhooks | [Webhooks](https://developers.etsy.com/documentation/essentials/webhooks/): signed order notifications | Poll/manual sync for this milestone; no public webhook route or unverified subscription automation |
| Rate limits | [Rate limits](https://developers.etsy.com/documentation/essentials/rate-limits/): application quotas and 429 retry-after | One read request at a time per adapter; bounded job attempts, delayed retry, no retry storms |
| Remote revocation | No programmatic OAuth revoke endpoint verified in the consulted reference/authentication guide | Local disconnect deletes tokens and cancels pending sync; user must remove access in Etsy's integrations settings; remote success is never claimed |
| Personalized digital delivery | [Fulfillment](https://developers.etsy.com/documentation/tutorials/fulfillment/) does not establish a unique per-order personalized attachment capability | Out of scope; no delivery endpoint, listing-file upload, or fallback messaging automation |

## Scopes and consent

Request listings_r and transactions_r for private listings and sales intake. Shop-by-owner lookup is documented as API-key authorized, so do not request shops_r merely because it appeared in the proposal. No listings_w, listings_d, transactions_w, address or email scopes. App key header follows current authentication documentation; credentials remain server-side. Recheck exact endpoint scopes before enabling a changed capability.

Present permissions, purpose, read-only actions, unsupported actions, connected shop identity, last successful sync, expiry/reauthorization state and disconnect effects before consent. App login (Auth.js) and Etsy seller consent are different grants.

## Token/security contract

The guide documents short-lived access and longer-lived refresh tokens; implementation uses returned expiry rather than hard-coded lifetime. It does not establish safe concurrent-refresh behavior or replay semantics: only one connection refresh may run; uncertain results require reconnect. Store updated token pairs atomically and never return them in session/client DTOs.

State is random, hash-stored, expiring and consumed once under a database transaction; PKCE verifier is encrypted. Callback validates logged-in user, current membership, store, expiry and state before exchanging any code. Reauthorization/disconnect fences old sync work. Provider errors are represented by safe codes, not raw HTTP bodies or token-bearing URLs.

The local secret boundary uses AES-256-GCM with a separately supplied 32-byte key, key ID, random nonce and connection/tenant-bound authenticated data. It is a development implementation of a vault port, not cloud KMS. Key custody/rotation, access controls, backups and retention require deployment review before customer data.

## Unresolved/live validation gates

- App registration/access approval, allowed seller count, commercial eligibility and actual credentials are not supplied. See [access documentation](https://developers.etsy.com/documentation/).
- Documentation rendering was incomplete for parts of the current reference. Exact live listing offers, receipt cancellation/refund fields and complete pagination behavior must pass redacted live contract fixtures before live intake is enabled.
- No programmatic remote revocation capability was established. Local disconnect is supported independently; Etsy-side removal is a manual seller action.
- No live OAuth, token refresh, revoked-token response, event subscription or rate-limit response was exercised.
- Unknown/malformed payloads must fail schema validation or surface an input issue; never invent customer information, refund allocation or a missing transaction.

The development adapter supplies canonical synthetic listings/orders covering single/mixed carts, variants, missing input, Unicode and repeats. It is visibly labeled; it cannot connect to Etsy, create a token, write listings or send customer messages. Live capabilities remain behind the same ports and explicit environment gates.
