# Product specification

Status: initial foundation, 2026-10-05. Requirements are binding; scope and milestone recommendations await confirmation. Technology choices are in ARCHITECTURE.md.

## Product purpose

Give sellers a reliable operational workspace for personalized digital orders: configure production once, inspect each purchased unit, resolve missing information, create branded output, review it, and deliver it with a traceable history. The platform is professional ecommerce operations software. It is not a chat-first writing tool.

Initial customers are Etsy tarot and psychic reading sellers. Generalize only the stable concepts: customer input, seller identity, product recipe, content structure, visual presentation, fulfillment, approval, and delivery. Astrology calculations or tarot card selection can later be typed product capabilities; neither is mandatory for all products.

## Actors and ownership

- A user signs in and has organization membership. An organization is the tenant and owns one or more stores, configurations, artifacts, and usage.
- A store represents one connected Etsy shop. A connection represents authorization, not the store's identity or history.
- An owner configures the store, permissions, production, and budgets. An operator concept permits reviewing and delivering without owning credentials. A full invitation/roles UI can wait; permissions cannot be inferred solely from knowing an order ID.
- A reader/persona is a versioned production identity, not necessarily a platform user. Several products may share it.
- A buyer is an external customer/context source, not automatically a SaaS account.

V1 may expose one owner and one store per organization while preserving the above relationships.

## Seller journey

| Stage | Required behavior |
| --- | --- |
| Account/store | Establish tenant and ownership; explain the service and data handling |
| Etsy connection | Explain each permission and capability before consent; show connection health and disconnect |
| Import | Import listings and variations without changing Etsy listings; show last synchronization time |
| Product setup | Select eligible listings; explicitly map variants or listing defaults; flag unmapped purchases |
| Production setup | Define required customer fields, reader identity, sections, length, language, product rules, document appearance, and review policy |
| Test | Use clearly labeled test context, preview content and PDF, show estimated/actual production cost, and record the tested revision |
| Activate | Publish an immutable validated revision after a successful test; require explicit choice of how activation affects existing pending orders |
| Intake | Import paid orders, preserve purchased facts, split quantities into independently tracked units |
| Validate | Resolve product and required inputs per unit; missing or ambiguous information blocks only the affected unit |
| Produce | Create validated content and documents; expose progress, failure stage, and recoverable actions |
| Review | Inspect customer context and the exact document revision on desktop or phone; approve, reject, correct, or explicitly regenerate |
| Deliver | Send through a verified channel or perform an explicit manual handoff; record evidence and scope of delivery |
| Operate | Pause products, resolve failed jobs/connections, and see remaining units without reopening completed work |

## V1 recommendation

Include a bounded production recipe, versioned seller style, separate content/document templates, paid-order ingestion, quantity expansion, structured input validation and manual correction, a controlled model gateway, deterministic PDF rendering, mobile preview, explicit approval, and a delivery ledger. Initially require review before delivery. Automatic production after valid intake may be a per-product opt-in; manual creation remains available.

Treat automated Etsy delivery as a capability gate, not a presumed V1 feature. If no permitted order-specific API channel is established, V1 can provide a private downloadable file and manual Etsy handoff with seller-confirmed delivery evidence. This is not automated delivery, and file download alone is not delivery confirmation.

Exclude a general workflow builder, arbitrary seller code, native mobile applications, a marketplace of templates, multi-channel commerce, complex subscription billing, autonomous customer conversations, and unattended delivery from initial scope. Record internal usage now; commercial billing can follow an explicit pricing decision.

## Operational object contract

An Order contains Line Items. A Line Item preserves Etsy transaction identity, listing/variant facts, purchased quantity, and source personalization. For quantity N, it has N Fulfillment Units with stable indexes. Each unit has its own context, configuration snapshot, production history, approval, and delivery allocation.

Example: Love Reading x2 + Career Reading x1 + Future Reading x1 produces one order, three line items, and four units. Love unit 2 may await clarification while the other three proceed. The order displays aggregate progress (for example, 3 of 4 delivered), never a fabricated single-product status.

Quantity does not prove that two identical outputs are intended. Whether units share context or need separate recipients must be explicit. Default: hold quantity >1 if per-unit context allocation is unclear. Seller correction is auditable; never fabricate another customer.

## Configuration and differentiated output

Production combines platform rules, a seller/reader identity revision, a product revision, and a customer context revision. Platform safety and ownership constraints cannot be overridden by seller examples or customer instructions.

Seller identity includes tone, terminology, persona, expressions to prefer/avoid, examples with provenance, and brand references. Product identity includes category, sections, optional deck/card settings, length/detail, instructions, language policy, required inputs, and output schema. Document appearance includes typography, colors, layout, brand assets, and page settings.

Seller identity influences content without promising uniqueness of every phrase. Acceptance uses contrasting synthetic seller profiles and reviewer assessment, not a claim that outputs can never coincide. Differentiate using deliberate configuration; do not add randomness or extra paid calls just to create difference.

Content templates specify semantic sections and structure; document templates specify presentation. Switching layout should permit rerendering accepted content without buying another content generation. A new PDF revision still needs approval because presentation can alter meaning or visibility.

## Inputs, review, and lifecycle

- Preserve raw source personalization and normalized fields separately. Support several typed answers, Unicode, customer language, and seller corrections with provenance.
- Required fields are product-specific. Do not universally require date of birth, gender, or partner data. Use unambiguous date formats and minimize personal information.
- Missing input is an operational problem with a remedy, not a reason to guess. V1 may let the seller collect clarification through Etsy manually and enter the response with attribution.
- Explicit regeneration creates a new generation and retains history; retry of document rendering reuses successful content. A newer generation invalidates the active approval selection.
- Approval binds to exact content/document hashes and revisions. Editing, changing inputs, or replacing a document requires new approval. Cancel/refund eligibility is checked again before external delivery.
- Product pause stops admission of new production; treatment of already running/queued units must be visible and explicitly defined. Recommended default: stop queued work, retain completed artifacts, flag in-flight results for review.
- An unconfigured purchased listing remains visible as an unautomated item. It must not disappear or automatically inherit another product's recipe.

## Information architecture

For the current application, [UI_UX_DESIGN_LOCK.md](UI_UX_DESIGN_LOCK.md) supersedes the earlier provisional IA: Home, Orders, Products, Settings. Home surfaces actionable reading issues and recent orders; Orders is the working queue. Product setup supports generic versioned customer fields, content sections, output and workflow preferences. Store/connection, Account and Advanced live in Settings. Generation, document rendering and sending remain out of scope.

Seller-facing “Reading” represents an individual fulfillment unit without changing its domain identity. Ready means current information checks passed, not created or delivered. Home and Orders use existing issue projections; no parallel workflow engine or persisted UI status is introduced.

## Success and acceptance

V1 acceptance requires: all operational actions work on a phone; a mixed cart and quantity >1 process independently; unmapped or invalid items are held without blocking siblings; double clicks and event replay do not create duplicate logical work; rendering failure does not repeat model production; approvals match delivered revisions; secrets never reach client payloads; another tenant cannot access any order/artifact; each model attempt has usage and cost attribution, including uncertain failures.

Track actionable measures: time to review-ready output, time waiting on input, review rejection rate, completion/delivery failure rate, duplicate work incidents, and cost per completed unit including failures. Do not show charts without sufficient data or a seller decision they support.

## Recommended first implementation milestone

**Read-only Etsy intake and mobile triage**, after the decision gates below:

1. Establish account/organization/store ownership and secure Etsy connection with connection-health/disconnect states.
2. Import listings and receipt/transaction data through a narrow adapter; provide synthetic fixtures if access is still pending, clearly distinguishing that from live integration.
3. Persist orders, line items, stable quantity units, source snapshots, and input/mapping issues. Display all units, including unautomated purchases.
4. Show mobile order list/detail and Needs Attention; allow auditable mapping/context corrections and product pause/manage actions within this milestone's scope.
5. Verify replay and reconciliation do not duplicate units, canceled work remains ineligible, and tenant access is enforced across APIs and jobs.

Deliverable: a seller can connect, see one real mixed checkout (when authorized access is available), understand four independently tracked units, and resolve intake issues from a phone. No model calls or delivery automation are necessary for this milestone. The next slice adds one recipe, one provider, one PDF template, approval, and a verified/manual delivery path.

## Decisions before implementation

Resolve application access and delivery feasibility first. Then decide pilot store/membership scope, per-quantity context policy, variant mapping fallback, historical-order import cutoff, activation behavior for pending orders, initial output languages, product category constraints, refund/cancellation policy, retention, spending limits, and whether V1 production starts automatically after validation. See the engineering decision register for runtime selections.

## Current product-configuration slice

A selected Etsy listing can create a generic Product draft. Sellers add TEXT/LONG_TEXT/DATE inputs, ordered content sections, TEXT/PDF output preferences and Manual/Assisted workflow intent. Save permits incomplete drafts; server validation and transactional activation publish one immutable version. Editing active instructions creates a new draft. Orders/line items/quantity readings preserve their cardinality and bind the exact version effective at ingestion. Required-input readiness uses the existing deterministic validator and explicit per-reading quantity allocation; unstructured data is not inferred.

One selected active configured product enables Continue to Home; other selected listings remain Setup required. Product Setup and Products reuse the approved visual language. No AI, PDF rendering, seller identity, billing or delivery is introduced. See [PRODUCT_CONFIGURATION.md](PRODUCT_CONFIGURATION.md) for invariants, compatibility and limitations.
