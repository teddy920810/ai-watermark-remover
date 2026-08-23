# Design QA — Alternating full-section surfaces

## Evidence

- Source visual truth: `C:\Users\ermei\AppData\Local\Temp\watermarkgemini-blue-rhythm-production-20260823\01-production-home-desktop.png` — current production layout before this iteration, 1425 × 5708 pixels.
- Browser-rendered implementation:
  - `C:\Users\ermei\AppData\Local\Temp\watermarkgemini-section-alternation-20260823\02-local-after-desktop.png` — homepage desktop, 1425 × 5678 pixels from a 1440 × 900 requested viewport (1425-pixel browser content width), device scale factor 1.
  - `C:\Users\ermei\AppData\Local\Temp\watermarkgemini-section-alternation-20260823\03-local-after-mobile.png` — homepage mobile, 375 × 844 pixels from a 390 × 844 requested viewport (375-pixel browser content width), device scale factor 1.
  - `C:\Users\ermei\AppData\Local\Temp\watermarkgemini-section-alternation-20260823\04-tool-after-desktop.png` — tool landing page desktop, 1425 × 4295 pixels.
- Combined comparison: `C:\Users\ermei\AppData\Local\Temp\watermarkgemini-section-alternation-20260823\05-before-after-comparison.png`.
- State: signed out, idle uploader; desktop and mobile responsive layouts.

## Full-view comparison

The requested sequence is visibly complete: full-width deep hero, light process, deep Features, light privacy/standards, deep guides, and light FAQ. The previous dark-card-on-light-page hero has become one uninterrupted full-width dark section. Features and guides now use the same deep surface, while their white content cards remain high-contrast focal points.

## Focused-region comparison

- Hero: the full viewport width is dark at desktop and mobile sizes; its content remains constrained to the established site grid.
- Features: the whole section is dark, including the spacing around and between white feature cards.
- Privacy/standards: the section returns to ice blue with navy text and standard white information card treatment.
- Guides: the entire section is dark with white heading text and readable white article cards.
- Tool landing pages: full-width dark hero, light process, dark Features, and light FAQ follow the same system.

## Required fidelity surfaces

- Fonts and typography: families, sizes, weights, wrapping, and CMS headings are unchanged; only foreground colors needed for dark surfaces changed.
- Spacing and layout rhythm: existing 1240-pixel hero and 1120-pixel content grids are preserved inside full-width backgrounds. Desktop and mobile checks found zero horizontal overflow.
- Colors and tokens: deep sections use `#07142b`; light alternating sections use ice `#f3f7ff` or white `#ffffff`.
- Image quality and assets: all existing CMS images, logos, screenshots, and icons are unchanged.
- Copy and content: operational copy, SEO content, FAQ values, Blog content, legal text, and CMS values are unchanged.

## Findings

- No actionable P0, P1, or P2 findings remain.
- Browser console warning/error scan is clean.
- Mobile menu opens, the first FAQ expands, and horizontal overflow remains zero.

## Comparison history

1. Before-state: Hero was a dark rounded card inside a light page; Features was light, privacy was dark, and guides was light.
2. Requested iteration: Hero became full-width dark and subsequent main sections now alternate light/dark through the FAQ.
3. Final comparison: desktop homepage, mobile homepage, and desktop tool page show the intended sequence without clipping, layout regression, or contrast issue.

## Implementation checklist

- [x] Hero background spans the full section.
- [x] Third screen Features is fully dark.
- [x] Fourth screen privacy/standards is light.
- [x] Fifth screen guides is fully dark.
- [x] Sixth screen FAQ is light.
- [x] Homepage and tool landing pages share the technical surface system without sharing content.
- [x] Operational content and media unchanged.

final result: passed
