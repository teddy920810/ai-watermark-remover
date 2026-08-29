# Background Remover Design QA

## Evidence

- Source visual truth: `C:\Users\ermei\AppData\Local\Temp\codex-clipboard-3a53942b-73ae-4567-bb0f-57458a372aae.png` (idle/upload state) and `C:\Users\ermei\AppData\Local\Temp\codex-clipboard-26da0d16-09cb-4840-a59f-710e3e078bbc.png` (result/color state).
- Browser-rendered implementation: `test-results/design-qa/background-remover-desktop-idle.png` and `test-results/design-qa/background-remover-mobile-idle.png`.
- Combined comparison: `test-results/design-qa/idle-comparison-normalized.png`.
- Focused uploader comparison: `test-results/design-qa/uploader-comparison.png`.
- Desktop browser viewport override: 1633 × 889 CSS px; implementation capture: 1618 × 881 px; device scale factor: 1.
- Source idle capture: 1633 × 885 px, normalized to 1618 × 881 px for the full-view comparison.
- Mobile browser viewport override: 390 × 844 CSS px; implementation capture: 375 × 812 px; device scale factor: 1.
- State: unauthenticated idle/upload state. The result and color-picker state is covered by the automated background-removal flow; a real provider call was intentionally not made during visual QA.
- Follow-up implementation check: `C:\Users\ermei\AppData\Local\Temp\codex-clipboard-f3ccbb8d-0938-4557-b73e-16deacb7625a.png` (reported narrow selected state) and `C:\Users\ermei\AppData\Local\Temp\codex-clipboard-59b43f7f-04c6-4e61-acba-6a08272ff302.png` (requested full-width result behavior).
- Production incident check: `C:\Users\ermei\AppData\Local\Temp\codex-clipboard-adb07fbd-5b32-497c-be4d-8ecbd9212995.png` (expired result image) and `C:\Users\ermei\AppData\Local\Temp\codex-clipboard-854e201f-a438-48bb-b2b9-42ad4474ad6b.png` (upload area, stale preview, and fetch error rendered together).
- The incident state was inspected in the Codex in-app browser on `https://www.watermarkgemini.com/background-remover`. The DOM confirmed a broken result image backed by an expired signed URL and the overlapping error/upload/preview state shown in the screenshots.
- Follow-up browser viewport: 1582 x 674 CSS px. After selecting `public/uploads/background-remover-product-photo.png`, the marketing copy was hidden, the tool measured 1225 px wide, and no horizontal overflow was present.

## Findings

- No actionable P0, P1, or P2 findings remain.
- The reference uses a centered marketing headline and a standalone uploader, while the implementation uses the existing WatermarkGemini two-column tool-page hero. This is an intentional product-system constraint, not accidental drift: the uploader hierarchy, dashed drop target, paste affordance, supported formats, privacy treatment, rounded card, and result color controls carry over from the reference inside the established site shell.
- P3: The reference includes sample-image shortcuts, while the implementation does not. They are optional discovery aids and would add content and storage behavior outside the requested upload flow.

## Required Fidelity Surfaces

- Fonts and typography: Existing WatermarkGemini display and body typography is retained. Heading, instruction, format, and privacy copy remain legible at desktop and mobile sizes with no truncation.
- Spacing and layout rhythm: Desktop keeps the established two-column hero; the uploader and hero stack cleanly on mobile. No horizontal overflow was detected at either viewport.
- Colors and visual tokens: The implementation maps the reference's high-contrast primary CTA and neutral upload surface to the site's blue, navy, mint, border, radius, and shadow tokens.
- Image quality and asset fidelity: Seven original raster assets were created for the steps and feature sections. The transparency treatment uses a real checkerboard image asset. No placeholder, handcrafted SVG, emoji, or CSS-drawn marketing illustration was substituted.
- Copy and content: Upload, paste, supported-format, privacy, transparent PNG, background-color, and shared-credit concepts are explicit. There is no “Go to Editor” action.

## Interaction and Runtime Checks

- Primary interactions covered: file selection, drag/drop contract, clipboard paste listener, authenticated processing request with `background-removal`, original/result comparison, preset colors, custom color, PNG download, reset, and shared balance refresh.
- The desktop and mobile browser captures showed the expected tool and no “Go to Editor” text.
- Browser console errors/warnings checked after desktop and mobile reload: none.
- Accessibility and core route coverage passed in the repository E2E gate.
- The follow-up regression contract asserts that selection adds `is-tool-expanded`, hides the hero copy, and produces a desktop tool wider than 1000 px.
- The completed-state regression contract asserts the API PNG is displayed first on the transparency grid, the bottom-right control switches to the original blob URL, and a second click restores the API result URL.
- The expired-link regression forces the first result image request to return 403, then verifies that the component refreshes the completed job links, restores the provider PNG, keeps the completed result visible, and creates no second processing job.
- Download actions now obtain fresh completed-job links immediately before downloading. A refresh failure remains inside the completed result state and falls back to the original preview instead of exposing a broken image or reopening the upload drop zone.

## Focused Comparison

The uploader is the key conversion region and was compared separately at readable scale. Its affordance, format guidance, drop-zone boundary, and privacy note are visually clear. No additional focused crop was needed for the below-the-fold editorial modules because their typography, images, and responsive behavior follow existing shared components already covered by the page and accessibility tests.

## Comparison History

- Pass 1: Full-view and focused uploader comparisons found no actionable P0/P1/P2 mismatch. No visual fix was required, so no recapture iteration was needed.
- Pass 2: The user-reported selected state was reproduced. The hero now expands to the established page container after upload; a local in-app browser check confirmed the large preview and no overflow. The result-state behavior is locked by the focused browser regression without spending a Replicate credit during local QA.
- Pass 3: The production expired-link state was reproduced in the in-app browser. The fix is locked by a browser regression that simulates the same 403-to-refreshed-URL transition without making a provider call or consuming a shared credit.

## Implementation Checklist

- [x] Desktop upload state follows the established WatermarkGemini tool layout.
- [x] Mobile layout has no horizontal overflow.
- [x] Uploader supports click, drop, and paste.
- [x] Transparent, preset, and custom-color result controls are implemented.
- [x] Editor handoff is omitted.
- [x] Original visual assets are used for all initialized step and feature modules.
- [x] Selecting an image expands the tool across the page container.
- [x] A completed job defaults to the transparent provider PNG.
- [x] The bottom-right comparison control switches to the original and back to the result.
- [x] An expired result URL refreshes automatically without reprocessing or consuming another credit.
- [x] Upload and completed-result surfaces are mutually exclusive after a recoverable network failure.

final result: passed
