# Blog SEO design QA

- Date: 2026-08-22
- Reference: user-provided Word/CMS design screenshot (local QA input; not committed)
- Implementation: `output/playwright/blog-seo-design-iab.png` (local QA artifact; ignored)
- Comparison: `output/playwright/blog-seo-design-comparison.png` (local QA artifact; ignored)
- Route: `http://localhost:4321/blog/remove-moving-watermark-from-video`
- Desktop viewport: 1280 x 900 (in-app browser emulation)
- Mobile viewport: 390 x 844
- Reference pixels: 1275 x 420
- Implementation capture pixels: 411 x 889 (Codex in-app browser panel capture of the 1280 x 900 emulated page)
- State: local Astro development build using the current CMS article

## Evidence reviewed

- Full article header at desktop and mobile widths.
- Focused reference/implementation comparison around Figure 5, the Official Adobe note, Method 4, and the Best for list.
- Four-column comparison table at desktop width and internal horizontal scrolling at mobile width.
- Quote cards, unordered markers, ordered steps, image container, caption, H2, H3, links, inline code, and code blocks.
- Browser console warnings and errors.

## Findings and fixes

- P1 fixed: article summary was duplicated visually below the H1; it remains available for metadata and blog-list cards only.
- P1 fixed: article measure was too narrow for long-form SEO content and four-column tables; the article body is now wider while legal pages remain unchanged.
- P1 fixed: the global reset removed list markers inside article and Quote content; unordered and ordered markers are now explicitly restored.
- P1 fixed: four-column tables could widen the mobile page; overflow is now contained within the table.
- P2 fixed: the mobile H1 produced excessive wrapping; the mobile type scale is reduced without changing the desktop hierarchy.
- P2 fixed: Word-style pipe callouts were not semantic Quote elements; the reference article now uses real Markdown blockquotes.
- P2 accepted: the Word reference uses several semantic fill colors, while the site intentionally uses one CMS-friendly branded Quote treatment for notes, boundaries, and Best for cards.

## Final checks

- Desktop comparison preserves the reference hierarchy and improves public-page spacing.
- Mobile document width equals viewport width; the table scrolls internally.
- Quote lists show visible markers.
- Console warnings/errors: none.
- Final result: passed.
