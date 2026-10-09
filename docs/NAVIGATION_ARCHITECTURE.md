# Navigation architecture — Milestone 1.5

Visible navigation: Dashboard (`/`), Orders (`/orders`), Products (`/products`), PDF Studio (`/pdf-studio`), then Settings (`/settings`) in the existing bottom utility position. Account remains the existing identity link to `/settings#account`.

The long-term hierarchy is Overview: Dashboard; Workspace: Orders, Products, Readers; Production: Production, PDF Studio; Utility: Settings and Account. Readers and Production remain deferred until their dedicated UI milestones; no disabled links or placeholder routes are exposed.

`/pdf-studio` is a thin server page re-export of the existing `/settings/pdf-design` page within the same Store setup layout. Both URLs share owner/Store authorization, design-query validation, configuration, data services, renderer, preview API and save commands. Existing bookmarked URLs and `?design=` selections remain functional without redirect/query loss. Old and new Studio paths select PDF Studio in the sidebar; product appearance selects Products. New Settings, product appearance and saved-design links use `/pdf-studio`. The existing server action module remains in place to preserve imports and contracts.

Settings retains Store integrations, configuration, profile/style, Account and Advanced controls. Its existing PDF link is a shortcut to the first-class workspace, not a separate destination. Studio breadcrumb now reflects Dashboard → PDF Studio. No other Settings workflow moved.

The Milestone 1 frame, responsive breakpoints, native dialog, Escape/focus handling and scroll locking are unchanged. Existing system icons are extended with one document glyph. No new dependencies, backend logic, schema, generation, production or rendering changes.

Validation: 68 focused tests across nine files passed, including navigation ownership, compatibility-page identity, authentication denial, server shell identity/onboarding, Studio save/preview/security and assignment links. Typecheck, production build and diff checks passed. Browser acceptance is NOT VERIFIED: no authenticated browser tab is exposed in the current browser inventory. Real responsive spacing, drawer keyboard behavior and overflow remain an acceptance gate; SSR tests are not runtime proof.
