# UI / UX design lock

Approved redesign scope: 2026-10-05. This lock supersedes provisional navigation and technical screen terminology in PRODUCT_SPEC.md and DESIGN_PRINCIPLES.md for the current application. Domain architecture, authorization, audits, intake and database constraints remain unchanged.

## Seller mental model

Connect Etsy → Set up products → Receive orders → Create reading → Review → Send.

Milestone 1 supports connection, existing customer requirements, received orders and information review only. Create reading is disabled with an explicit explanation. Production, output and delivery steps are coming later; no fabricated completion or sending state is stored.

## Navigation and screen hierarchy

Four destinations: Home (/), Orders (/orders), Products (/products), Settings (/settings). Store and Etsy access live in Settings. /store redirects to Settings, preserving existing OAuth callback notices. /needs-attention redirects to the contextual Orders queue. Account and Advanced are sections within Settings, not extra primary destinations.

Home answers what needs attention: welcome/store, compact factual counts, actionable reading issues, recent orders. No analytics charts or oversized cards. New means received and still awaiting creation, not an invented unread flag. Ready means customer information and current product checks passed; it does not mean content exists. Ready to send and Completed remain empty while production/delivery are unavailable.

Orders is the daily queue: customer, checkout reference, reading count/product summary, derived status, date, Open. Search customer/order/product and filter All, New, Needs info, Ready, Completed. Order status is an aggregate of existing reading issues, never persisted as a substitute for the domain model. Mixed readiness remains visible (including ready reading count).

Order detail: customer/order/date → purchased product groups → independently numbered readings → one primary next action. Order #2002 remains one checkout with Love ×2 and Career ×1, three readings. Information editing preserves expected revision, recipient confirmation, original answers and audits. Safety holds cannot be dismissed through presentation.

Products: compact Etsy product list, Etsy state, application setup status, Set up/Edit disclosure. Setup shell has Basics, Customer information, Reading, Output, Delivery. Only existing requirements and pause/resume controls operate. Variant choice labels come from purchased variations; raw IDs are advanced. No images exist in the current canonical listing contract: show a neutral placeholder rather than inventing assets or changing that contract.

Settings: Store, Etsy connection, Account, Advanced. Explain access before consent. Show connection health, last successful update, supported connect/disconnect actions and retained history. Manual refresh and redacted sync diagnostics are secondary Advanced controls. Current manual-worker limitation stays honest; no implied automatic synchronization is introduced.

## Terminology

| Internal | Seller facing |
| --- | --- |
| FulfillmentUnit / unit | Reading / Reading 1 of 2 |
| Intake checked | Ready |
| Mapping / configure intake | Product setup / Set up product |
| Unmapped listing | Product setup required |
| Missing / unusable input | Customer information needed / Review customer information |
| Quantity context | Confirm who this reading is for |
| Source changed | Purchase details changed |
| Sync run | Store update (technical history under Advanced) |
| Revision | Saved information version (Advanced only) |

Keep customer field labels intact: validation depends on them. Existing corrections never invent missing customer facts. Unknown issue codes receive a neutral review message rather than exposing raw codes.

## Visual rules

Original commerce interface informed by the requested reference principles: compact records, quiet chrome, clear hierarchy and contextual actions. Neutral warm background, charcoal text, restrained green accent, amber only for action-required status. System typography, subtle borders, small radii, no giant white widgets, gradients, glass, chat, robots, sparkles or decorative charts. Shared buttons/inputs/status/loading/error/empty patterns. One dominant action per reading; technical controls secondary.

## Desktop and mobile

Desktop: narrow persistent navigation, constrained readable content, aligned list columns and product groups. Tablet: same hierarchy with fewer columns. At 390px: fixed four-item bottom navigation with safe-area padding; list rows reflow, no primary horizontal scrolling; product groups stack; input forms remain inline and reachable. Controls at least 44px, visible keyboard focus, non-color status labels, Unicode wrapping and dir=auto on customer text. Avoid full-card nested links and hover-only actions. Expanded information editors preserve draft state on a save error.

## Progressive disclosure

Default views show purchased products, customer facts, actionable issues and safe next actions. Put Etsy transaction/listing/variant IDs, original source comparisons, version numbers and update attempts under Advanced details. Credentials are never included, even in Advanced. Refund/cancellation/payment/source-change holds stay visible. Debug information must never become an alternative authorization path.

## Validation and limits

Re-run existing domain/security/database suites plus full typecheck/build. Add focused tests only for status/filter projections where incorrect display could hide holds. Manually inspect Home, Orders/filter/search, #2002 detail, missing answers, unmapped variants, Unicode, Products setup, Settings/disconnect at 390/768/1440px when runtime access permits. Prior environment lacks Auth.js registry access, native PostgreSQL shared memory and loopback server binding; static implementation is not browser acceptance. No new dependency or backend feature is needed.
