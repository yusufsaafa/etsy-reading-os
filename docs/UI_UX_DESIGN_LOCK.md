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

Second visual pass (2026-10-05) replaces the first warm/green system completely. Cool-neutral app background #F7F8FA, white surfaces, #F3F4F6 subtle surfaces, near-black #111827 text, gray metadata and #E5E7EB borders. A restrained #2563EB accent is reserved for selection, primary actions and focus. Success, warning and danger appear in small semantic elements. Seller brands never affect the SaaS shell.

Shared tokens define semantic colors, 6/10px radii, 4–40px spacing scale and 44px controls. Typography: 30px desktop page titles, 17px section titles, 14px body, 12–13px metadata. No gradients, glass, mystical identity, large shadows or giant dashboard cards. Navigation uses original consistent 20px inline SVG icons, with no icon dependency.

Metrics, orders and customer information use scoped CSS modules imported by their components. Metrics use discrete definition lists. Orders use a semantic table with scoped columns, row separators and mobile record reflow. Customer labels and values use separate dt/dd blocks with explicit margin/gap, never adjoining inline spans. Reading status stays beside its heading instead of justified against the viewport edge. Reading panels are restrained and constrained to 960px, while general content is centered within a 1280px outer width.

Screenshot extracted text confirmed concatenated values, headers and answers. Pixels were unavailable. The first source already included spacing selectors, so stale/mismatched runtime CSS is a possible additional cause, not a verified diagnosis. Check stylesheet loading and the exact checked-out branch during local review. The second pass does not claim browser or visual acceptance.

## Desktop and mobile

1440px: 232px persistent white sidebar, brand/workspace at top, aligned navigation and store/settings area at bottom; centered main content with deliberate 24–48px gutters. Home uses one compact metrics surface, attention list and orders table. Order detail uses a 960px reading column with nearby badges and separated answer fields.

768px: compact top shell with horizontal navigation, no desktop sidebar reservation; 24px page gutters, order table becomes record rows and attention reasons sit below identity. Settings retains an intentional label/content grid.

390px: four-item fixed bottom navigation, compact brand/store header, 20px gutters, two-by-two metrics, stacked order records, clearly grouped reading panels and single-column settings. Safe-area and bottom content padding keep actions above navigation. Inputs/editors wrap long Unicode and use 16px phone text to avoid browser input zoom. Primary controls and navigation have at least 44px targets; keyboard focus and textual status remain visible. No clipping/hiding overflow is used as a substitute for responsive sizing. Expanded editors retain drafts on save errors.

Manual browser review at all three widths remains the product owner's acceptance gate. Source/CSS inspection verifies explicit metric separation, table columns, dt/dd answer separation, bounded reading groups, responsive breakpoints and no raw primary action styling.

## Progressive disclosure

Default views show purchased products, customer facts, actionable issues and safe next actions. Put Etsy transaction/listing/variant IDs, original source comparisons, version numbers and update attempts under Advanced details. Credentials are never included, even in Advanced. Refund/cancellation/payment/source-change holds stay visible. Debug information must never become an alternative authorization path.

## Validation and limits

Re-run existing domain/security/database suites plus full typecheck/build. Add focused tests only for status/filter projections where incorrect display could hide holds. Manually inspect Home, Orders/filter/search, #2002 detail, missing answers, unmapped variants, Unicode, Products setup, Settings/disconnect at 390/768/1440px when runtime access permits. Prior environment lacks Auth.js registry access, native PostgreSQL shared memory and loopback server binding; static implementation is not browser acceptance. No new dependency or backend feature is needed.
