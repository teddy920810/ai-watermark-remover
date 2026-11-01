# Public image display

Status: P3 shared renderer implemented locally. P5 content replacements were revoked by the user on 2026-11-01; original paths, alt and example copy are restored. Verification belongs to the stage ledger. No deployment is implied.

`src/components/ImageDisplay.astro` owns public image display. `ResponsiveImage.astro` remains its responsive source/dimensions/fallback primitive. Editors and video players keep their own functional controls.

- No image: render nothing; the enclosing module decides whether the module is required.
- Image 1 only: static image without labels, range, line or handle.
- Image 1 and a different Image 2: Image 1 is Before on the left, Image 2 is After on the right. Enable comparison only after both load and their aspect ratios match. Matching ratios cannot establish that two photos show the same composition; editors must verify that separately.
- Both sources of a pair load eagerly. Otherwise an After that finishes first can hide the still-lazy Before and prevent comparison from becoming ready. Single-image loading still follows its normal eager/lazy setting.
- Failure: show the successfully loaded image without comparison controls. If neither loads, show the existing readable failure state. A generated placeholder never counts as a loaded comparison source.
- Comparison starts at 50%, supports native range keyboard navigation, pointer capture and touch. `image-display:reset` resets a newly selected example to 50%.

Natural aspect ratio is the default. Existing fixed-size cards/step frames explicitly pass `fit="cover"`; both sources then use the same frame and crop rule. This keeps nested image markup from leaving blank bands in a pre-existing frame. It does not turn a single image into a comparison.

Pages CMS exposes Image 1 and optional Image 2. It does not expose slider implementations, upload endpoints, illustrative watermark text or overlay presets. New records do not acquire synthetic watermark defaults. Public templates use ImageDisplay for both single images and pairs. Stored legacy fields are retained for content compatibility; the renderer never synthesizes an overlay from them. A configured primary image takes priority over an illustrative legacy comparison image; a real legacy pair with an explicit Before source remains compatible. Both rendered image alts preserve the supplied value verbatim; the renderer adds no suffix.

Use two independent sources showing the same composition and frame for a real comparison. Existing composite images may remain static under the content owner's decision; engineering must not replace them or edit their pixels, paths or alt. The inventory marks baked controls for operator/SEO review. No real Before image may be fabricated by adding a temporary watermark.

The [manifest](./CONTENT_MEDIA_MIGRATION.json) retains the P3 inventory of 166 distinct assets. All 53 P5 replacement mappings are revoked; original content is restored against 574ad43 and checked by an independent baseline. The 52 baked-control candidates and one already missing asset remain operator/SEO pending. Missing media retains normal fallback without a substituted SEO path. No image file was renamed, edited or deleted and no genuine pair was invented. Existing content supplies zero configured genuine independently stored Before/After pairs. Original content resources cannot be deleted without content-owner authorization and compatibility evidence. Draft and runtime user media are outside this public content inventory.

Style ownership: `design-system.css` owns tokens, base elements, buttons, navigation/account chrome and auth modal primitives. `global.css`, `home-*.css` and `tool-landing.css` own Site marketing layouts; zero-consumer editor and synthetic overlay selectors have been retired. `workspace.css` and component-owned styles own App/editor/product layouts. App and public Pricing import the foundation directly. Do not copy marketing selectors into the foundation to fix a product layout.

Shared auth completion only treats a same-origin popup or origin-scoped BroadcastChannel message as a request to recheck the authoritative session. Workspace prepares the file and refreshes its quote, then still requires the processing button. Retiring source editors does not change accepted old-protocol prices, operation identity or the retained client/API recovery contract. Session failures are retryable and disposed listeners ignore late session checks. The official sign-in initializer is unchanged.

Canvas helpers map coordinates and write opaque black/white masks. Object removal retains clamped coordinates and alpha >10; refinement retains unclamped coordinates and alpha >0. Brush, lasso, history, eraser and output policies stay in their operation modules. Media detection and local draft storage continue using the existing shared client primitives; server media validation remains authoritative.

Verification: targeted unit contracts and the isolated browser fixture in `tests/component` cover static/pair/failure/ratio, 0/50/100, keyboard, drag, touch, cancellation and reset. The fixture uses unrelated existing test images solely to test mechanics and does not claim processing results. Production OAuth and Provider acceptance remain separate release gates.
