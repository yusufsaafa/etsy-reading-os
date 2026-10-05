# Design principles

Status: V1 UX requirements, 2026-10-05. Current seller-facing design and navigation are locked in UI_UX_DESIGN_LOCK.md; broader future production requirements remain below.

## Product identity

Design an ecommerce operations workspace. The central objects are orders, purchased units, products, issues, output documents and delivery. AI is a production implementation detail; truthful disclosures and a technical usage view remain available where appropriate.

Do not use purple/blue AI gradients, glowing controls, robots, decorative sparkle icons, chat-first navigation, repeated "Generate with AI" labels, excessive glassmorphism, or meaningless analytics. Prefer readable typography, neutral surfaces, restrained accents, clear borders and status indicators. Do not hard-code a mystical visual brand into the SaaS; a seller's document brand can be mystical without the operational interface being so.

Suggested action language: Create reading, Create output, Retry document, Review, Approve, Deliver, Pause automation. Use a category-appropriate noun when known and a general output noun otherwise. Distinguish retrying a failed step from paying for a new content revision.

## Navigation and hierarchy

Current primary navigation: Home, Orders, Products, Settings. Needs-attention work is contextual on Home and Orders; Store/Etsy access lives in Settings. Phone navigation uses a four-item bottom bar. See [UI / UX design lock](UI_UX_DESIGN_LOCK.md), which supersedes previous provisional IA and technical presentation language.

Dashboard shows work requiring action, pending review, deadlines and integration health. Counts link to real filtered work lists. Display useful factual metrics only; charts need a decision and enough data. Do not equate paid, produced, approved and delivered.

Order detail starts with checkout identity and progress, then individually labeled line items and quantity units. Example: Love Reading — Reading 1 of 2 and Reading 2 of 2, each with distinct status. An order-level badge must reveal partial progress and affected units.

## Phone operations are a release requirement

At narrow phone widths, a seller must be able to see new orders, inspect all customer inputs, locate issues, correct inputs, create/recreate output, preview the exact document, approve, deliver, pause/manage products, resolve auth problems, and retry a safe failed stage. No operational action may require hover, drag-only interactions, a wide table, or a desktop-only editor.

- Convert desktop tables into meaningful stacked cards or compact lists; preserve filters, sort and status semantics.
- Use touch targets at least 44 by 44 CSS pixels where practical, adequate spacing, labeled controls and visible focus.
- Provide a stable primary action area without hiding content or colliding with the on-screen keyboard. Keep secondary/destructive actions clearly distinguished.
- Preserve edits on interruptions and handle expired sessions without silently losing customer corrections. Do not cache sensitive drafts on devices without a deliberate privacy decision.
- Show durable job progress after navigation/reload. A request interrupted by poor connectivity must reconcile its existing command key before offering a new billable action.
- Make long personalization text and typed answers readable; do not truncate the only copy of required data. Preserve multilingual content and support bidirectional text safely.
- Allow cancellation/refund/authorization issues to be resolved through a clear phone-accessible path, including links to Etsy when manual action is necessary.

Desktop may offer side-by-side configuration/preview, denser lists and keyboard shortcuts. Initial complex setup can be optimized for desktop, but existing product mappings, status and routine settings must remain manageable on a phone. Do not use "desktop required" as a shortcut for daily operations.

## Exact artifact review

Offer an inline paginated PDF preview or authenticated image-based page preview with zoom and an accessible text companion. The text view alone is insufficient for approving layout: review the actual document revision that will be delivered. Preview URLs remain private and short-lived; failures provide a retry/download fallback without automatic model regeneration.

Show the unit/customer, content revision, document revision and approval state near the action. Warn when a newer revision or context change superseded an open preview. The server rejects stale approval/delivery even if the page was left open. A replacement PDF requires fresh approval.

Approval and delivery are separate actions for V1 unless a clearly labeled combined action explicitly binds both to the same current manifest. Delivery confirmation summarizes recipient/channel and covered units. A bundled delivery must state which units remain undelivered. Manual handoff states must say "Awaiting seller confirmation" rather than "Delivered" after download.

## Problem design

Every issue presents: affected unit/store, what happened in seller language, whether output/customer delivery is affected, last attempt, and the safe next action. Keep raw provider traces behind a redacted technical detail view.

| Situation | Operational presentation |
| --- | --- |
| Missing buyer input | Identify missing field; offer auditable correction/clarification; keep siblings available |
| Unmapped variation | Show purchased choices; offer explicit mapping, no guessed fallback |
| Content succeeded, PDF failed | Show saved content; Retry document, with no new content charge |
| Model outcome unknown | Show checking/needs reconciliation; explain a new request may incur additional cost |
| Etsy access revoked | Show reauthorization and affected actions; do not expose tokens |
| Delivery outcome unknown | Show verification/manual confirmation; do not offer blind resend |
| Canceled/refunded item | Show hold and reason; preserve existing output/history |

Disabling a button helps prevent repeated clicks, but server idempotency is required. On conflict, refresh state and preserve any unapplied draft. Bulk actions are not necessary in V1; if added, report outcomes per unit.

## Trustworthy Etsy connection

Before consent, explain each requested permission, why it is needed, and enabled actions. Describe actual limitations of the current connection, not the imagined future platform. Show granted capabilities, connected shop, last sync, reauthorization state, and a reachable disconnect action. Explain what happens to pending work and retained records when disconnecting.

Do not imply endorsement by Etsy. Include required marketplace attribution in the appropriate prominent location after checking current terms. Show delivery limitations during onboarding before activation; do not hide manual steps until after production.

## Configuration UX

Use a guided setup with independently saved draft sections: listing mapping, customer inputs, reader/style, content structure, document appearance, production/review policy, test, publish. Label content templates and document templates separately with different previews. A single "prompt" textbox is insufficient as the product model.

Show test cost before execution, exact tested revision, validation results and visual preview. Publishing a modified revision requires a new test. Explain whether changes apply to future purchases or explicitly adopted pending work. Pause/activate status and its effect on queued work are visible.

## Accessibility and validation

Target WCAG 2.2 AA principles: semantic controls, contrast, keyboard support, visible focus, screen-reader labels, error association and non-color status cues. Check zoom/reflow and reduced motion. Operational status must not depend on animation or icon recognition.

Before releasing an operational screen, exercise the complete path at a 360 CSS-pixel viewport and a typical desktop viewport, with touch and keyboard, long names, Unicode/RTL input, loading/error/empty states, interrupted connection, and partial-order completion. Verify phone PDF pages are legible and controls do not obscure them. Synthetic data is sufficient for usability checks; live capability claims require live authorized evidence.
