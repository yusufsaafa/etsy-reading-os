# Application shell — Milestone 1

Base: 01c84ba1a2d1d1950cba8a5d1de405c8a178efb4, branch codex/ui-ux-design-lock.

Recovered the existing uncommitted implementation without resetting or replacing it. The interrupted assertion and scroll-lock/Escape fixes were absent and were completed during recovery.

The authorized server shell retains currentScope, authenticated identity and organization/Store-scoped querying. Only Store name, demo designation and account display name enter the client frame. Public routing and onboarding destination selection remain unchanged.

The frame adapts the supplied Figma source: 232px white desktop sidebar, compact blue mark, Store identity near the top, Home/Orders/Products navigation, Settings near the bottom and an account-settings link. Shell-scoped warm-neutral variables leave public/auth/onboarding tokens intact. Default content is bounded to 1210px, with a 1500px Studio variant. No fonts/dependencies/routes or business services were added.

At <=980px a compact header opens the same navigation using native dialog.showModal(). Native modal behavior provides focus containment and background inertness. Escape and close/navigation actions share dismissal and trigger focus restoration. An effect locks and restores body scrolling. There is no drawer animation; the existing reduced-motion rule remains. Phone gutters are 16px, tablet 23px and desktop 38px. Runtime keyboard and responsive acceptance remains unverified.

Shell integration changes also add the existing Settings Account anchor, replace nested main wrappers in two Store setup children with div, and correct generic workspace loading copy. Page business logic remains intact.

Validation: 40 focused tests across six files passed (36 navigation/entry/product/document tests and four server identity/authorization/onboarding tests). Typecheck, production build and git diff --check passed. Initial assertion ordering and isolated test auth-import issues were corrected without weakening behavior assertions. Active links are now inspected independently of serialized attribute order.

Browser acceptance: NOT VERIFIED. Prior local-origin inspection displayed unauthenticated public entry, while the configured tunnel failed DNS. Current browser inventory exposes no authenticated Chrome tab. Desktop/mobile visual quality, 360/375/390px overflow, real Tab cycling, Escape and focus restoration still require authenticated browser checks. Native dialog source and successful SSR tests are not browser acceptance evidence.

No real Store configuration, customer operation, Etsy action, generation, PDF rendering change, schema change, push or deployment occurred. next-env.d.ts and tsconfig.json generated changes are preserved and excluded from the implementation commit.
