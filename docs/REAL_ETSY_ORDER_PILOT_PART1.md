# Real Etsy order pilot — Part 1

Date: 2026-10-08. Starting commit: `a6f10339d4571b592bed2431959977610f90477f`, branch `codex/ui-ux-design-lock`. Local Mac checkout and local native PostgreSQL; no public tunnel, callback/configuration change or interactive reauthorization was required.

## Controlled real evidence

The unique owned MysticReadingHouse Store was authorized through the existing owner boundary. Its connected encrypted grant had the required read scope. The expired grant was refreshed successfully through the existing refresh mechanism. Only that legitimate token lifecycle update was permitted; no Product or order-domain write was performed.

One recorded sample used a 90-day window, newest paid receipts first, maximum three receipts. One list GET and three detail GETs returned HTTP 200 and JSON. The list exposed count/results and no pagination metadata. A subsequent diagnostic invocation was attempted, but its output was not retained in the tool context; it is not counted as additional distinct receipt evidence. No further discovery was required.

| Recorded sample | Count |
|---|---:|
| Receipts / purchased lines | 3 / 3 |
| Eligible / held lines | 0 / 3 |
| Known local listing identities | 3 |
| Exact active purchase-configuration identity matches | 1 |
| Exact matches blocked by the activation-time fence | 1 |
| Lines without an exact active mapping | 2 |
| Explicit unsupported-input / missing-evidence categories | 0 / 0 |
| Quantity-one lines | 3 |
| Purchase selections / supported text answers | 6 / 3 |

Receipt and transaction identifiers, listing identity, purchase timestamps, paid evidence and recognized receipt statuses were present. Refund arrays were empty. All three transaction source classifications were `is_digital=false`; these were preserved, never rewritten. This is transaction classification evidence, not a new listing-type observation.

Purchased evidence normalized through the existing strict raw boundary to `etsy-purchased-line/v1`: two purchase selections and one text answer per line. Receipt/transaction linkage and every-variation accounting passed. No dropdown, upload, unknown input, quantity-greater-than-one or mixed-cart case was observed. No buyer files were fetched.

Buyer identity was present on all three receipts and matched their embedded transaction identity structurally. Values, names and answer text were neither printed nor retained. This does not prove downstream identity propagation: the existing canonical normalizer does not consume buyer identity. The buyer must not be inferred to be the reading subject.

## Eligibility interpretation

Exact matching uses the complete canonical property/value identity set and Store-owned active ProductVersion policy. Labels, SKU and array order supply no runtime meaning. One current approved configuration matched, but the purchase preceded activation and no applicable historical adoption permitted it. The resolver correctly withheld that version. The other two lines had no active exact configuration.

The authoritative resolver returned `unmapped_listing` and `ambiguous_historical_mapping` for all three lines. These are overlapping categories, not six held lines. `unmapped_listing` here means no applicable fulfillment policy after resolution, not that the three source listings are absent. Generic historical ambiguity can also reflect unavailable question mapping; only the independently verified timestamp-fenced exact match is counted as historically blocked. Current listing definitions were not fetched or used to reinterpret purchased answers.

No eligible real purchase was demonstrated. Current configuration/input compatibility beyond the historical fence is not accepted by this sample. No fence was bypassed and no historical adoption was created.

## Harness and privacy

`scripts/real-etsy-receipt-pilot.ts` is an explicitly invoked acceptance tool, not a route, polling loop or live intake adapter. It reuses the encrypted connection, refresh service, canonical normalizer and Product resolver. GET responses are capped at 1 MiB and requests at 15 seconds; redirects and non-JSON responses fail closed. List/detail identity mismatch and duplicate receipt identity reject.

Resolution runs in a native PostgreSQL read-only repeatable-read transaction. Scoped domain fingerprints were unchanged. This demonstrates this execution's read-only behavior; snapshot equality is not proof that unrelated concurrent workers did not write elsewhere. Raw Etsy responses exist only in memory, with no raw fixture, log or artifact. Safe output contains counts/categories only. No ingestion, generation, document, delivery or Etsy mutation was invoked. Refresh is an OAuth lifecycle operation, not an Etsy commerce mutation.

Run explicitly from the local checkout with Node 22 and local configuration:

```sh
node --import tsx --env-file=.env.local scripts/real-etsy-receipt-pilot.ts MysticReadingHouse
```

## Validation and Part 2 requirements

Focused unit tests: 70 passed (transport, existing normalizer/source assessment). Focused database tests: 24 passed (source resolution and historical adoption). Typecheck, production build and diff check passed. No production code, schema or migration changed.

ETSY-E2E-01, ETSY-CARDINALITY-01 and ETSY-INPUTS-01 remain OPEN. Part 2 must first select an actually applicable post-activation exact purchase or obtain an explicitly owner-approved pinned historical adoption; it must still pass purchased question identity/context, payment/refund/cancellation and quantity gates. The known generation-context omission of pinned Etsy fulfillment policy in the acceptance ledger must be resolved before production admission acceptance. Buyer identity propagation requires separate explicit implementation/evidence and must remain distinct from reading-subject roles. Quantity/mixed carts, edited-question drift, dropdown/upload semantics and nonempty refund/cancellation cases remain unproved.

No domain ingestion, Product activation, AI call, PDF generation, delivery, push or deployment occurred. Part 2 was not started.
