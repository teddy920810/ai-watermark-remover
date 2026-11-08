# Project instructions

## Maintenance authority and change closure

- Use the registered local project root for implementation, tests and release preparation. Read it through `AI_WATERMARK_PROJECT_ROOT` or the existing Codex project registry; do not add a drive letter as a runtime dependency or silently create another source worktree.
- At startup run `npm run project:check -- --read-only`. Before editing or switching branches, classify existing changes in an ignored JSON file with an explicit `paths` array and run `npm run project:check -- --classified <file>`. Unknown changes or a directory/origin mismatch block mutation, never read-only preservation. Recheck cwd, branch, HEAD, remote divergence and scope at handoff. Never reset away preserved work.
- Each fact has one authority: operation identifiers/limits in `src/lib/contracts/operation-catalog.ts`, route ownership and CMS entry policy in `src/lib/contracts/route-policy.mjs`, prices in server price books, UI rules in their shared components, and current documentation in `docs/INDEX.md`.
- Change behavior together with its contract, focused tests, affected CMS migration and relevant instructions. Record documentation updates or a reason they are not applicable; do not change unrelated documentation only to refresh dates.
- Development and CMS publication require applicable checks before production. CMS saves, required CI, Vercel builds and production acceptance are separate gates; verify current external enforcement rather than treating a save or historical record as proof.
- Register temporary adapters, old clients/APIs/assets and historical worktrees with owner, replacement, review stage and retirement evidence in `docs/COMPATIBILITY.md`. Review overdue items; never delete automatically.
- Upload and single/two-image rules are enabled per the refactor ledger. Do not claim unmigrated consumers conform to future rules. No new audio functionality, Provider request changes, or merging of free uses, purchased image Credits and processing Credits through refactoring.

## Codex task naming

- After the first user request makes the intended outcome clear, rename the current Codex task automatically without asking the user to provide a title.
- Use the format `AI Watermark｜specific outcome｜status`.
- Summarize the outcome in a short, concrete phrase; do not copy the full user prompt or use vague titles such as `new task`, `fix issue`, or `continue development`.
- Use one of these status labels when applicable: `规划中`, `进行中`, `待用户`, `已完成`, or `已上线`.
- Update only the outcome or status when the task meaningfully changes phase.
- Never pin, unpin, archive, or move a task automatically. Those sidebar choices remain with the user.

## Codex project workflow

- Treat this Codex project as the default execution workspace for repository-backed AI Watermark work that will be implemented, tested, or released.
- At the start of a new task, briefly classify it as planning-only or implementation and confirm that it belongs to this project. Do not repeatedly remind the user after classification.
- If the request arrives from a ChatGPT Chat or Work discussion, summarize the agreed outcome, scope, protected boundaries, acceptance criteria, and delivery target before editing.
- Keep planning-only requests read-only until the user explicitly asks to implement. Cross-product strategy may remain in ChatGPT; do not force a context switch when the current task can be completed safely here.

- Generate SEO and content pages statically with Astro.
- Use React islands only for interactive features.
- Never expose R2 or provider credentials to browser code.
- Store uploaded images, results, and MVP job state in the private R2 bucket.
- Keep watermark processing behind the `WatermarkProvider` interface.
- Do not commit `S3-info.txt`, `.env`, or `.env.*` files.
- Follow the risk-based verification rules below and the linked test guide for local checks and production smoke selection.
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

- 所有行为改动先运行证明目标行为的红测，再做最小修改并运行绿测。
- [测试指南](docs/TESTING_GUIDE.md#动态验证矩阵)是本地检查、抽查范围、失败处理和生产 smoke 的唯一矩阵；只选一次覆盖实际风险的门禁，不叠加重合检查。
- API、鉴权、R2、Provider、安全响应头、构建链、依赖、CI、全局配置、范围不确定或定向检查失败，必须在本地运行 `npm run release:verify`。CI/构建链精简自身仍按高风险验证。
- `CI / verify` 和 `Required target artifacts` 是合并 `main` 的稳定必需门禁，保持严格更新与可信 GitHub Actions 来源。CI 按 `scripts/ci-plan.mjs` 的明确允许名单选择 docs/content/ui/full；未知或混合范围运行完整 `npm run verify`，不降低覆盖率或安全阈值。门禁未通过不得合并。
- 标准门禁受端口、进程或平台问题阻塞时，先安全排查一次；仍不能运行则补充覆盖缺失范围的等价验证并明确限制，不重复已有充分证据。
- 仅文档/指令修改只检查 Markdown、diff、范围和工作区；被构建或自动化消费的文档按实际风险验证。未受影响的发布门禁标记为 `not applicable`，不能用额外检查凑成全部通过。

## Content and SEO ownership

- 图片文件名、路径、引用、图片字节、alt/coverAlt/imageAlt、示例说明，以及标题、正文、FAQ、SEO元信息和内容URL均由内容/SEO角色拥有。研发重构只改实现，不自行重写、替换、重命名或删除这些内容。
- 未获得用户明确的内容修改授权时，保留原内容值；字段迁移须逐字段验证语义等价，并核对最终HTML中的图片与alt，不能用迁移清单、别名或替换图片字节掩盖内容变化。
- 原素材缺失、图内烘焙滑柄或文案问题登记为运营/SEO待办，保留正常fallback，不擅自替换素材或编造对比图。交互按钮、状态、处理协议由研发维护。
- PR须单列内容/SEO影响及授权依据。`src/lib/content/seo-content-ownership.test.ts`的独立基线不随迁移映射自动变化；合法内容更新须由内容负责人明确授权并审阅对应基线变化。
- 内容 API 的普通保存不更新独立基线。被明确授予内容域权限的运营 Token 持有人须先审阅具体差异，再对当前 digest 显式 review；服务端保留 PR 评论审计，仅同步本次批准记录并经同一受保护 PR/必需 CI 发布。研发验收不得借用这一机制批准或改写既有 SEO 内容。

## Third-party integration contract rules

- Treat vendor-provided installation snippets as integration contracts, not ordinary code to refactor.
- Preserve an official or user-provided snippet verbatim, including function shape, argument objects, command order, script attributes, IDs, and initialization timing. Replace only documented placeholders.
- Do not modernize, reformat semantically, optimize, or substitute "equivalent" syntax in analytics, authentication, payment, cloud SDK, consent, or other third-party bootstrap code unless the vendor documentation explicitly supports the change.
- If a deviation is necessary, explain the exact difference and risk to the user and obtain approval before editing it.
- Before changing an integration, verify the current primary vendor documentation. Record the relevant documentation link in the PR, commit context, test, or nearby comment when the constraint is non-obvious.
- Add a focused regression test before changing critical bootstrap code. The test must lock the vendor-required behavior, not merely check that a script URL or ID is present.
- Verify the real end-to-end signal after deployment: for analytics, confirm the expected network event or provider Realtime/DebugView result; for other integrations, use the provider's equivalent diagnostic. Script presence and HTTP 200 alone are insufficient.
- Do not declare a production integration complete when end-to-end verification is unavailable. Clearly report the unverified step and ask the user to perform or authorize the provider-side check.
