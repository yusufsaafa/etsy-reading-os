# Contextual information standard

Inline expanding informational disclosures are prohibited throughout Reading OS and future screens. Do not use details/summary, accordions or collapsible help that pushes surrounding content down. Use the shared InformationPopover for short explanations. Use its accessible dialog variant or an existing dedicated page for long reference content. Do not nest popovers.

The shared component uses native top-layer auto popovers: buttons activate with keyboard, mouse or touch; Escape and outside interaction dismiss. Focus enters the panel on opening, Escape/Close restores the trigger, and outside interaction respects the destination's focus. Native modal dialogs provide focus containment, Escape dismissal and a named Close control. Popovers use measured fixed positioning, screen-edge clamping, visual viewport/scroll/resize tracking and bounded scrolling. No external dependency or runtime demo mode was added.

## Audit of all 23 original disclosure patterns

| Location / original label | Classification | Decision |
| --- | --- | --- |
| Dashboard: Metric definitions | A informational | Four individual KPI information popovers, definitions and sample counts retained |
| Dashboard: Connection details | A informational | Status stays visible; contextual popover retains guidance and Settings navigation |
| Dashboard: Daily values | A reference data | Dialog retains all daily observations and coverage caption |
| PDF Studio: About logo support | A informational | Popover |
| PDF Studio: Preview controls and supported layouts | A long reference | Dialog |
| Onboarding product selection: Setup required | A informational | Popover |
| Products editor: Review all purchase choices | A long reference | Dialog, existing navigation link retained |
| Products editor: How preparation targets work | A informational | Popover |
| Products editor: Validation details | A informational | Popover, validation issues unchanged |
| Products: Generation test setup | A long reference | Dialog, configuration status and links retained |
| Products: How does this work? | A long reference | Dialog retains educational examples |
| Orders: Advanced details | A informational | Popover retains revision information |
| Orders: Original purchase & advanced details | A long reference | Dialog retains original purchase evidence |
| Historical review: Review approved configuration | A reference | Dialog retains approved configuration |
| Products editor: More field examples | B functional control | Preserved field-creation menu |
| Orders: Review information / Review customer information | C essential workflow | Preserved customer-information editor |
| Products list: Variant settings & advanced details | C essential workflow | Preserved variant configuration and pause/resume actions |
| Settings: Disconnect store | C essential workflow | Preserved destructive action and explanation |
| Settings: Store updates & technical details | C essential workflow | Preserved manual import action, run status and technical evidence |
| Onboarding Etsy: Connection options | C essential workflow | Preserved disconnect action and explanation |
| Sign-in: Development demo account | C essential workflow | Preserved development authentication form |
| Seller style: Paste previous work | C essential workflow | Preserved form, validation and submission feedback |
| Seller style: Remove | C essential workflow | Preserved deletion confirmation and feedback |

No accordion component or additional application-owned collapsible informational implementation was found. Functional menus, filters, mobile navigation drawers and contextual action controls are exempt. The eight mixed essential workflows above remain explicitly documented exceptions; converting their forms/action lifecycles is deferred rather than silently changing behavior in this correction. Purely informational content must not use that exception.

## Verification

163 focused/regression tests pass, covering Dashboard, shared positioning/markup contracts, products, onboarding, shell, access, PDF and review. Typecheck, production build and diff checks pass. Positioning tests cover desktop and narrow mobile edges; markup tests verify native invokers, dialog semantics and named close controls.

Browser interaction/visual acceptance remains NOT VERIFIED: no authenticated controllable Reading OS tab is available. Native Escape/outside dismissal, actual focus transitions, touch behavior, layout stability and viewport rendering require browser acceptance; static/source tests are not a substitute. No authentication bypass or real-store fixture mutation was performed.
