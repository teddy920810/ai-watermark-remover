# Project instructions

- Generate SEO and content pages statically with Astro.
- Use React islands only for interactive features.
- Never expose R2 or provider credentials to browser code.
- Store uploaded images, results, and MVP job state in the private R2 bucket.
- Keep watermark processing behind the `WatermarkProvider` interface.
- Do not commit `S3-info.txt`, `.env`, or `.env.*` files.
- Write or update tests before implementing behavior changes.
- Before handing off changes, run `npm run verify`; it includes coverage, lint, build, and browser E2E.
- Run `npm run test:smoke:production` after production environment, domain, R2, CORS, or deployment changes. It writes temporary objects to the real bucket, so do not run it speculatively or in a loop.

## Project startup

- The canonical repository is `teddy920810/ai-watermark-remover`; reject similarly named checkouts whose `origin` does not match.
- Before editing, report the normalized path, `origin`, branch, HEAD, and working-tree status. Preserve unrelated user changes.
- Read this file, `README.md`, and `docs/DEVELOPER_GUIDE.md` completely before implementing.
- Separate user-gated prerequisites from work Codex can complete. Continue all unblocked Codex-owned work and batch the minimum user requests.
- Keep implementation and repository scripts cross-platform; prefer Node/npm scripts over shell-specific logic.

## Delivery target

- For every new request, establish whether the final target is local iteration or a change merged into `main`.
- If the user's request and current context do not make the target explicit, ask before committing, pushing, opening or merging a pull request, or deploying.
- For local iteration, implement and verify locally without committing, pushing, opening a pull request, merging, or deploying unless the user later expands the target.
- For a `main` delivery, use a dedicated branch and complete the requested commit, pull request, merge, deployment, and production verification workflow.

## Release status gates

- Report code verification, repository/PR state, Vercel deployment, DNS/certificate state, OAuth flow, and production smoke as separate gates.
- Do not label a delivery complete when an applicable gate is pending or blocked.
- If similar failures affect multiple repositories, check provider status and local process conflicts before changing code or branches. Avoid repeated retries during a confirmed platform incident.

## Third-party integration contract rules

- Treat vendor-provided installation snippets as integration contracts, not ordinary code to refactor.
- Preserve an official or user-provided snippet verbatim, including function shape, argument objects, command order, script attributes, IDs, and initialization timing. Replace only documented placeholders.
- Do not modernize, reformat semantically, optimize, or substitute "equivalent" syntax in analytics, authentication, payment, cloud SDK, consent, or other third-party bootstrap code unless the vendor documentation explicitly supports the change.
- If a deviation is necessary, explain the exact difference and risk to the user and obtain approval before editing it.
- Before changing an integration, verify the current primary vendor documentation. Record the relevant documentation link in the PR, commit context, test, or nearby comment when the constraint is non-obvious.
- Add a focused regression test before changing critical bootstrap code. The test must lock the vendor-required behavior, not merely check that a script URL or ID is present.
- Verify the real end-to-end signal after deployment: for analytics, confirm the expected network event or provider Realtime/DebugView result; for other integrations, use the provider's equivalent diagnostic. Script presence and HTTP 200 alone are insufficient.
- Do not declare a production integration complete when end-to-end verification is unavailable. Clearly report the unverified step and ask the user to perform or authorize the provider-side check.
