# Image-credit pricing layout QA

Scope: adapt the account holder's selected four-column pricing reference to WatermarkGemini's existing brand and approved one-time credit packages. This is visual and interaction acceptance, not Live payment acceptance.

Source visual truth: `output/pricing-design/reference.png` (the supplied HitPaw screenshot, 1680 × 957). Implementation: `/app/credits`, using the real approved catalog with checkout closed and no payment credentials in the local preview.

## Evidence and normalization

- Desktop CSS viewport: 1680 × 957. Chrome's captured PNG is 1665 × 948; the comparison normalizes it proportionally to 1680 × 957.
- Mobile CSS viewport: 390 × 844. Captured PNG: 375 × 812; the full-page capture is 375 × 3979. No horizontal overflow was observed.
- Before/final captures: `output/pricing-design/desktop-before.png`, `desktop-final.png`, `mobile-first-screen.png`, `mobile-final.png`.
- Full-view combined comparison: `output/pricing-design/desktop-comparison.png`. Focused card comparison: `output/pricing-design/cards-comparison.png`. Both the reference and implementation were opened together before the final judgment.
- The in-app browser could not attach. The existing Chrome connection was used for the local design check; no PayPal or Google account interaction was performed.

## Findings and comparison history

1. Initial P2: the duplicate back link, extra eyebrow and long introduction pushed the cards substantially below the reference's first-screen composition. Removed the desktop-only duplication and eyebrow, shortened the introduction and tightened hero spacing. The final same-size comparison confirms aligned title/card hierarchy and visible prices and actions. The additional closed-checkout notice is an intentional release state; it is absent when checkout opens.
2. No remaining actionable P0/P1/P2 visual differences. The reference's subscription names, ratings, struck-through prices and seasonal promotion are replaced by the actual Free / Starter / Plus / Pro offer and one-time-payment disclosures. The recommendation and the selected package have distinct states.

## Required fidelity surfaces

- Typography: existing Plus Jakarta Sans display and DM Sans body fonts; large price hierarchy, aligned plan labels, readable descriptions and feature lists. Copy length differs intentionally from the reference.
- Layout: four equal rounded cards on desktop, two columns at tablet width, one column on mobile; consistent action baselines, feature dividers and card padding. Mobile header controls remain visible.
- Color: existing navy, blue action/text and pale-blue surfaces. Plus uses the brand blue with white content. Focus/selection have visible native radio and border states.
- Images and icons: existing WatermarkGemini logo and installed Lucide icon families. No reference brand, promotion image, fake rating or replacement artwork was introduced.
- Content: API-backed USD prices and 4,990 / 9,990 / 19,990 credits; eligible-tool costs 100 / 10 / 10; free uses are independent and take priority. PRO, refinement and video remain excluded.

## Interaction and verification boundaries

- Choosing Plus updates the native radio and purchase review to 9,990 image credits / USD 9.99. Choosing a package creates no order; the free link navigates to the image workspace without creating an order.
- Closed checkout has no PayPal SDK/payment action. Existing order recovery and refund controls remain in place.
- New layout regressions first failed with three cards. The first combined payment run passed 21/22; an existing reload case reached its assertion before development modules finished loading. The unchanged case and both new layout cases passed the isolated final run (3/3, original timeouts).
- Chrome logged one unattributed storage-access message during the preview. No corresponding project exception or broken interaction was observed in the automated trace; real Google sign-in remains a separate release gate.
- Real purchase, signed callback delivery, paid-credit processing and refund acceptance remain pending. They are not implied by this design check.

final result: passed
