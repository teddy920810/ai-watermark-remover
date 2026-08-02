# ClearMark AI MVP

SEO-first Astro website with a React upload island, Vercel API routes, private Cloudflare R2 storage, and a provider-independent mocked processing flow.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Map the existing `S3-info.txt` values to `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_ENDPOINT`.
3. Keep `R2_BUCKET=watermark`.
4. Run `npm run dev`.

Never commit either local credentials file. The application reads credentials only in server-side modules.

## R2 configuration

Keep the bucket private. Configure its CORS policy using `docs/r2-cors.example.json`, replacing the production origin before applying it. Configure three lifecycle rules in Cloudflare so the `uploads/`, `results/`, and `jobs/` prefixes expire after one day.

The Mock provider copies the uploaded object into `results/`; it does not claim to remove a watermark. A real provider can be introduced behind `WatermarkProvider` without changing the UI or public API contract.

## Quality checks

```sh
npm test
npm run lint
npm run build
```
