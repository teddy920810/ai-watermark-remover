# Design QA — Blue site-wide visual system

## Evidence

- Source visual truth:
  - `C:\Users\ermei\AppData\Local\Temp\codex-clipboard-7d35a684-689a-473b-ad3f-0828c832efc2.png` — 1711 × 299 process reference.
  - `C:\Users\ermei\AppData\Local\Temp\codex-clipboard-5d74400a-1d2b-4a19-902d-f53419c51f65.png` — 614 × 330 hero reference.
  - `C:\Users\ermei\AppData\Local\Temp\codex-clipboard-345867f4-6470-4ace-a1ac-37e2f0a8d870.png` — 579 × 189 uploader reference.
- Browser-rendered implementation:
  - `C:\Users\ermei\AppData\Local\Temp\watermarkgemini-visual-qa-20260823\tool-desktop-final.png` — 1425 × 4353 full-page capture from a 1440 × 1000 CSS viewport.
  - `C:\Users\ermei\AppData\Local\Temp\watermarkgemini-visual-qa-20260823\tool-mobile-final.png` — 375 × 812 visible capture from a 390 × 844 CSS viewport.
- Combined comparison evidence:
  - `C:\Users\ermei\AppData\Local\Temp\watermarkgemini-visual-qa-20260823\design-comparison-final.png`.
  - `C:\Users\ermei\AppData\Local\Temp\watermarkgemini-visual-qa-20260823\process-comparison-final.png`.
- Density normalization: browser and source captures were compared at device scale factor 1; comparison boards proportionally downsample images without changing aspect ratio.
- State: signed out, idle upload state; desktop and compact responsive layouts.

## Full-view comparison

The implementation carries the source visual language across the existing product: high-weight navy headings, blue phrase emphasis, blue pill labels, white cards with light blue borders, green trust signals, a primary blue upload action, and a connected three-step sequence. Existing WatermarkGemini copy, branding, content hierarchy, upload behavior, and page routes remain intact.

## Focused-region comparison

- Hero and upload: the focused board confirms matching hierarchy, blue action emphasis, white surface, restrained border/shadow, and green benefit treatment.
- Process: the focused board confirms three equal cards, numbered blue steps, library icons, and directional connectors. Connectors disappear at compact breakpoints so the sequence remains readable.
- Supporting pages: desktop captures of the Blog index, Blog article, and privacy page confirm that cards, tables, quotes, links, headings, and legal content use the same tokens without copying landing-page structure where it would reduce readability.

## Required fidelity surfaces

- Fonts and typography: existing Montserrat/system stack retained; display headings now use the reference's heavier optical weight, tighter tracking, and stronger navy/blue hierarchy. Mobile wrapping remains readable without clipping.
- Spacing and layout rhythm: hero, uploader, process cards, content cards, Blog grids, article body, legal body, FAQ, and footer use consistent radii, borders, padding, and vertical rhythm. No desktop or mobile horizontal overflow was observed.
- Colors and visual tokens: blue `#2563eb`, navy `#0b1533`, pale blue surfaces, and green `#10b981` trust signals consistently map to the source.
- Image quality and asset fidelity: existing CMS images and brand assets were preserved. Interface icons use Lucide packages rather than text glyph approximations.
- Copy and content: site copy, SEO content, Blog content, legal text, and CMS-managed media were not rewritten.

## Comparison history

1. Initial desktop pass: the reference-inspired hierarchy and upload surface matched, but the process sequence lacked directional connectors. Fixed by adding library arrow icons between desktop step cards.
2. Initial mobile pass: the authentication action wrapped onto a second header row (P2). Fixed by introducing an explicit header-auth wrapper, hiding the long brand label at the compact breakpoint, and placing navigation in a floating mobile panel.
3. Accessibility pass: automated route coverage found insufficient contrast in the uploader's secondary instruction and privacy note. Fixed by darkening only those two blue-gray text tokens while preserving the selected palette.
4. Final pass: desktop and mobile captures show no remaining P0, P1, or P2 differences. The mobile menu opens, the FAQ expands, and browser console checks contain no errors.

## Findings

- No actionable P0, P1, or P2 findings remain.
- P3: the reference images are compressed and cover isolated sections rather than an entire site, so exact font rasterization and page-length proportions are intentionally treated as direction rather than pixel-identical requirements.

## Implementation checklist

- [x] Reference-inspired visual tokens and typography.
- [x] Hero, upload, trust, process, cards, FAQ, Blog, article, legal, and footer styling.
- [x] Desktop and compact responsive layouts.
- [x] Mobile navigation and FAQ interaction checks.
- [x] Browser console check.

final result: passed
