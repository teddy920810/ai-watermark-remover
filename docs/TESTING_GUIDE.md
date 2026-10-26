# 测试与质量指南

本指南面向开发者、内容共创者和运维人员。目标不是追求测试数量，而是让测试能够阻止真实线上故障。

## 测试分层

| 层级 | 命令 | 覆盖内容 | 是否访问生产 |
|---|---|---|---|
| 单元/集成 | `npm test` | 内容 schema、环境变量、API、Job、Provider、R2 命令与安全错误 | 否 |
| 覆盖率 | `npm run test:coverage` | 核心服务与 API，强制阈值 | 否 |
| 浏览器 E2E | `npm run test:e2e` | 上传 UI、失败提示、GA page_view、SEO、路由、无障碍 | 否，本地 Astro |
| 快速本地检查 | `npm run check:fast` | 内容同步和全部单元测试 | 否 |
| 内容检查 | `npm run check:content` | CMS/Blog/落地页/图片相关测试和生产 Build | 否 |
| UI 检查 | `npm run check:ui` | 公共布局相关测试和公共页面 Playwright | 否 |
| 完整验证 | `npm run verify` | 覆盖率、Lint、Build、E2E | 否 |
| 高风险发布检查 | `npm run release:verify` | 依赖审计、站点配置和完整验证 | 否 |
| 独立目标产物 | `node scripts/build-target.mjs site` / `app` / `worker` | 静态站、App Build Output 或真实 Worker bundle 与上传白名单 | 否 |
| Public Production Smoke | `npm run test:smoke:production` | 正式域名、静态入口和匿名保护，不触发 Provider | 是，只读 |
| 旧图片工具功能验收 | `npm run test:smoke:background-removal` / `test:smoke:object-removal` | 登录、真实 R2/Provider、PNG 产物和额度恰好扣一次 | 是，各消耗 1 次额度 |
| 新工作区公开检查 | `npm run test:smoke:processing` | 公开页面和 v1 能力接口 | 是，只读 |
| 新工作区功能验收 | `npm run test:smoke:processing -- --functional ...` | 实际媒体检查、报价、处理、下载和单次扣费 | 是，消耗明确确认的报价额度 |

## 首次准备

```sh
npm ci
npx playwright install chromium
npm run verify
```

不要安装或提交浏览器二进制。Playwright 会把浏览器放在用户缓存目录，GitHub Actions 会在 CI 中自动安装。

## 共创者应该做什么

### Pages CMS 内容编辑

Pages CMS 保存会提交到 `main`，随后触发 GitHub Actions 和 Vercel。内容编辑不需要在本地运行测试，但必须等待：

1. GitHub Actions 的 **CI / verify** 成功。
2. Vercel Production 状态变成 **Ready**。
3. 打开正式页面检查标题、图片、链接和移动端排版。

任一状态为 Error/Failed 时，停止重复保存，把文章名称、提交链接和错误截图交给开发者。

### 开发者

行为变更遵循 TDD：先添加会因目标行为缺失而失败的测试，再做最小实现并运行定向绿测。之后根据改动范围选择本地检查；PR CI 的完整 `verify` 必须成功后才能合并。第三方集成必须验证真实信号，不能只检查脚本存在。

## 动态验证矩阵

| 改动范围 | 本地必选 | 生产抽查 |
|---|---|---|
| 普通小改、局部纯函数 | 定向红/绿测试 + `check:fast` | 仅检查受影响功能 |
| CMS、Blog、落地页、图片内容 | `check:content` | 全部改动 URL 返回 200；浏览器抽查代表模板 |
| 布局、全局 CSS、公共 UI | `check:ui` | 首页、工具页、Blog 中受影响模板的桌面/移动端 |
| API、鉴权、R2、Provider、安全策略 | `release:verify` | 不采用抽样；执行适用的安全和认证检查 |
| 依赖、构建、CI、全局配置 | `release:verify` | 核对 CI、Vercel 和相应运行时结果 |
| 域名、OAuth、第三方集成 | `release:verify` + 专项测试 | 必须验证真实端到端信号 |

低风险改动不需要在本地和 CI 重复运行完整 `verify`；完整全量门禁统一由 PR CI 执行。若改动范围不确定、定向检查失败、跨越多个风险类别，升级到 `release:verify`。

`verify` 和 `verify:deploy` 先执行 `lint:code`，类型检查由随后 `build` 中的一次 `astro check` 承担。单独执行 `lint` 或 `build` 仍会检查类型。独立目标产物验证检查不同的路由、依赖和运行环境边界，不能用组合站点 Build 代替；仅构建受影响的目标，且同一工作区的 Astro 构建必须串行。

## 抽查标准

- Schema、URL、字段存在性、状态数量等可程序化约束，对全部改动记录执行检查，不抽样。
- 同一模板影响多个页面时，视觉上至少检查 1 个正向页面和 1 个负向页面；正向页面应出现目标行为，负向页面应保持不变。
- 全局 UI 改动至少覆盖首页、工具页、Blog 三类模板，以及桌面和移动端两个视口。
- 内容批量发布时，所有新增 URL 做 HTTP/标题/H1 检查，浏览器重点抽查第一篇、最后一篇和结构最复杂的一篇。
- 图片链路至少抽查 Blog 与工具页各一张，并验证 `<picture>`、WebP `srcset`、原图 fallback 和尺寸信息。
- 鉴权、对象归属、越权、安全头和第三方真实业务信号不能用代表页面抽查代替。

### 运维人员

环境变量或域名变更后先运行无成本的 `npm run test:smoke:production`。R2、CORS、鉴权、Provider 或功能链路变更时，只运行受影响操作的认证功能验收，不用背景移除的结果代替图片去水印或视频验收。

- 背景/物体移除：通过本机环境设置 `SMOKE_SESSION_COOKIE`，运行对应命令一次。
- 新图片/视频工作区：通过本机环境设置 `PROCESSING_ACCEPTANCE_SESSION_COOKIE`，按 [Worker 部署说明](product/WORKER_DEPLOYMENT.md#发布验收与恢复操作) 确认操作、样本、报价金额/单位和调用预算，再运行 `--functional` 一次。
- 功能验收会创建临时对象并消耗额度。缺少认证或预算时不得记为通过；提交结果不明确时查询原任务，不重新提交。

## 自动化保护

- `.github/workflows/ci.yml`：每次 PR 和 `main` 推送运行完整 `verify`；这是合并 `main` 的统一全量门禁。
- `.github/workflows/build-targets.yml`：同一份变更分类选择 Site、App 和 Worker，生成并验证对应产物。内容变更只选择 Site；Worker 入口只选择 Worker；共享处理代码选择 App 和 Worker；依赖与构建入口选择全部目标。Worker 验证真实打包和七文件上传上下文，不部署或调用 Provider。
- `.github/workflows/production-smoke.yml`：每天只运行无成本 Public Smoke；手工选择 operation 时才运行会消耗额度的 Functional Smoke。
- App 和 Site 由 Vercel Git 集成分别执行 `apps/app/vercel.json`、`apps/site/vercel.json` 的目标构建，并按变更范围跳过无关目标。根目录 `vercel.json` 的 `verify:deploy` 仅供保留的组合构建使用，不是当前独立发布的默认命令。
- 独立构建与 Worker 的产物验证见 [部署目标](../apps/DEPLOYMENT_TARGETS.md)。产物验证不执行部署，也不使用生产凭据；构建成功不能代替生产版本和真实处理验收。
- 覆盖率门槛：核心代码 lines/functions/statements ≥ 80%，branches ≥ 70%。当前结果应高于最低线，不能通过降低阈值掩盖缺失测试。

## 如何处理失败

- Vitest：定位失败用例，先确认是预期行为变化还是回归。
- Coverage：为未覆盖的重要分支补测试，不要先降低阈值。
- Build：检查 Astro content schema、Pages CMS 日期和必填字段。
- E2E：查看 `test-results/` 中的截图、错误上下文和 trace；这些目录不提交 Git。
- GA：确认 `g/collect` 中存在 `en=page_view` 和正确 Measurement ID，再看 GA Realtime。
- Production Smoke：依次检查 Vercel Production 变量作用域、最新部署、R2 凭据、CORS 和生命周期。

## 安全边界

- 测试代码、日志和 CI 中不得出现真实 R2 凭据或签名 URL。
- Production Smoke 只报告状态，不打印对象 Key、结果 URL或下载 URL。
- 本地 `.env.local` 和 `S3-info.txt` 永远不能提交。
- 不使用真实用户图片作为夹具，只使用仓库内生成或内嵌的无敏感测试图片。
- 新功能从 `docs/templates/functional-tool-contract.example.json` 建立合同，并按 `docs/FUNCTIONAL_TOOL_DELIVERY.md` 验收。
