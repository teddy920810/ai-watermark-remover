# Project instructions

- Generate SEO and content pages statically with Astro.
- Use React islands only for interactive features.
- Never expose R2 or provider credentials to browser code.
- Store uploaded images, results, and MVP job state in the private R2 bucket.
- Keep watermark processing behind the `WatermarkProvider` interface.
- Do not commit `S3-info.txt`, `.env`, or `.env.*` files.
- Write or update tests before implementing behavior changes.
- Before handing off changes, select the local verification gate from the risk-based rules below; do not skip the targeted red-to-green test.
- Run the public `npm run test:smoke:production` after production environment or domain changes. For R2, CORS, authentication, Provider, or processing-flow changes, run the matching authenticated functional smoke once; it writes real temporary objects and consumes a test credit, so do not run it speculatively or in a loop.
- Treat interactive tools as functional products, not SEO pages: define the operation, state transitions, artifact semantics, and credit invariants before implementation. A required authenticated or provider gate that is skipped is blocking, not passed.
- For a new or changed processing operation, add an operation-level browser test and run one manually triggered functional production smoke after deployment. Scheduled smoke must remain public-only unless recurring Provider cost is explicitly approved.

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

## Risk-based verification

- 所有行为改动都先运行能够证明目标行为的红测，再做最小修改并运行定向绿测。
- 低风险改动不要求在本地与 CI 重复运行完整 `npm run verify`。按范围选择：普通小改运行 `npm run check:fast`；CMS、Blog、落地页或图片内容运行 `npm run check:content`；布局、全局样式和公共 UI 运行 `npm run check:ui`。
- API、鉴权、R2、Provider、安全响应头、构建链、依赖、CI、全局配置，或任何范围不确定/定向检查失败的改动，必须在本地运行 `npm run release:verify`。
- CI 中的 `npm run verify` 是合并 `main` 的必需门禁；低风险 PR 可以依赖 CI 完成唯一一次全量覆盖率、Lint、Build 和 E2E，不得在 CI 未通过时合并。
- 生产验证按改动范围抽查：数据约束自动检查全部改动记录；视觉改动至少检查桌面/移动代表模板，并包含 1 个正向页面和 1 个负向页面；所有改动 URL 做只读 HTTP 检查。
- 鉴权、对象归属、安全和第三方真实信号不能用抽查代替；仅当改动涉及生产环境、域名、R2、CORS 或认证业务链路时运行会写真实资源的 Production Smoke。

### 最小充分验证与去重

- 每次只选择覆盖实际风险的最小充分门禁；不要叠加运行范围重合的 `check:fast`、`check:content`、`check:ui`、独立 Build 和 `release:verify`。
- 低风险 UI/CSS 修改的本地流程止于：定向红测、最小修改、定向绿测、一次 `npm run check:ui`，再对一个代表页面做桌面/移动检查，并检查一个不应受影响的负向区域。
- `check:ui` 已通过时，不再额外运行 `check:fast`、`check:content`、独立 Build 或 `release:verify`；仅当范围扩大、定向检查失败或出现新的风险信号时升级门禁。
- 合并 `main` 的低风险改动由 CI 唯一执行一次完整 `npm run verify`；本地不重复全量覆盖率、Lint、Build 和 E2E。
- 标准门禁因端口、进程或平台问题无法运行时，先进行一次安全的冲突排查；仍无法运行时使用覆盖缺失范围的等价替代验证并明确限制，不重复执行已经充分覆盖的验证。
- 共享 CSS 或公共组件修改只抽查受影响的代表模板，不把所有引用共享资源的路由都视为改动 URL；只有内容、路由或数据记录实际变化时才逐一检查对应 URL。
- 未受本次改动影响的发布门禁标记为 `not applicable`，不要为了将其标记为 `passed` 而额外验证。域名、证书、OAuth、R2、CORS、Provider 和 Production Smoke 仅在改动直接涉及对应范围时验证。
- 低风险 UI 上线后只需确认生产部署绑定预期 SHA，并对一个正向页面和一个负向区域做只读视觉/HTTP 检查。
- 仅文档或项目指令修改不运行产品测试；检查目标 Markdown、最终 diff、改动范围和工作区状态即可，除非该文档被构建或自动化脚本消费。

## Third-party integration contract rules

- Treat vendor-provided installation snippets as integration contracts, not ordinary code to refactor.
- Preserve an official or user-provided snippet verbatim, including function shape, argument objects, command order, script attributes, IDs, and initialization timing. Replace only documented placeholders.
- Do not modernize, reformat semantically, optimize, or substitute "equivalent" syntax in analytics, authentication, payment, cloud SDK, consent, or other third-party bootstrap code unless the vendor documentation explicitly supports the change.
- If a deviation is necessary, explain the exact difference and risk to the user and obtain approval before editing it.
- Before changing an integration, verify the current primary vendor documentation. Record the relevant documentation link in the PR, commit context, test, or nearby comment when the constraint is non-obvious.
- Add a focused regression test before changing critical bootstrap code. The test must lock the vendor-required behavior, not merely check that a script URL or ID is present.
- Verify the real end-to-end signal after deployment: for analytics, confirm the expected network event or provider Realtime/DebugView result; for other integrations, use the provider's equivalent diagnostic. Script presence and HTTP 200 alone are insufficient.
- Do not declare a production integration complete when end-to-end verification is unavailable. Clearly report the unverified step and ask the user to perform or authorize the provider-side check.
