# Project instructions

- Generate SEO and content pages statically with Astro.
- Use React islands only for interactive features.
- Never expose R2 or provider credentials to browser code.
- Store uploaded images, results, and MVP job state in the private R2 bucket.
- Keep watermark processing behind the `WatermarkProvider` interface.
- Do not commit `S3-info.txt`, `.env`, or `.env.*` files.
- Write or update tests before implementing behavior changes.
- Before handing off changes, run `npm test`, `npm run lint`, and `npm run build`.
