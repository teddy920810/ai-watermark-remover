# 测试与质量指南

本指南是本地检查与生产验收范围的唯一矩阵；README、开发指南、贡献指南和运维手册引用本页。`package.json` 提供命令入口，`scripts/verify.mjs` 统一步骤和执行，CI 仍由 `scripts/ci-plan.mjs` 从不可变 Git 差异选择范围。目标是让测试阻止真实线上故障。

## 测试分层

| 层级 | 命令 | 覆盖内容 | 是否访问生产 |
|---|---|---|---|
| 单元/集成 | `npm test` | 内容 schema、环境变量、API、Job、Provider、R2 命令与安全错误 | 否 |
| 覆盖率 | `npm run test:coverage` | 核心服务与 API，强制阈值 | 否 |
| 浏览器 E2E | `npm run test:e2e` | 上传 UI、失败提示、GA page_view、SEO、路由、无障碍 | 否，本地 Astro |
| 独立图片组件 | `npm run test:components` | 真双图、单图、加载失败、键盘/鼠标/触控和切换复位 | 否，独立本地夹具 |
| 快速本地检查 | `npm run check:fast` | 内容同步和全部单元测试 | 否 |
| 内容检查 | `npm run check:content` | 内容同步、内容测试、类型检查、Site 构建及该产物的响应图片检查 | 否 |
| UI 检查 | `npm run check:ui` | 响应图片准备、公共布局相关测试和公共页面 Playwright | 否 |
| 完整验证 | `npm run verify` | 覆盖率、Lint、Build、E2E和独立组件浏览器测试 | 否 |
| 高风险发布检查 | `npm run release:verify` | 依赖审计、站点配置和完整验证 | 否 |
| 独立目标产物 | `node scripts/build-target.mjs site` / `app` / `worker` | 静态站、App Build Output 或真实 Worker bundle 与上传白名单 | 否 |
| Public Production Smoke | `npm run test:smoke:production` | 正式域名、静态入口和匿名保护，不触发 Provider | 是，只读 |
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

Pages CMS 保存到内容审核分支，经受保护 PR 与必需检查后合并 `main`，随后由 Vercel 按目标发布。内容编辑不需要在本地运行测试，但必须等待：

1. GitHub Actions 的 **CI / verify** 和 **Required target artifacts** 成功。
2. Vercel Production 状态变成 **Ready**。
3. 打开正式页面检查标题、图片、链接和移动端排版。

任一状态为 Error/Failed 时，停止重复保存，把文章名称、提交链接和错误截图交给开发者。

### 开发者

行为变更遵循 TDD：先添加会因目标行为缺失而失败的测试，再做最小实现并运行定向绿测。之后根据改动范围选择本地检查；PR CI 的稳定必需检查必须成功后才能合并；分类与执行明细见下方自动化保护。第三方集成必须验证真实信号，不能只检查脚本存在。

## 动态验证矩阵

| 改动范围 | 本地必选 | 生产验收（仅发布时） |
|---|---|---|
| 仅文档或项目指令 | Markdown、diff、范围与工作区检查；被构建/自动化消费时按实际风险升级 | 不适用 |
| 普通小改、局部纯函数 | 定向红/绿测试 + `check:fast` | 仅检查受影响功能 |
| CMS、Blog、落地页、图片内容 | `check:content` | 全部改动 URL 返回 200；浏览器抽查代表模板 |
| 布局、全局 CSS、公共 UI | `check:ui` | 首页、工具页、Blog 中受影响模板的桌面/移动端 |
| API、鉴权、R2、Provider、安全策略 | `release:verify` | 不采用抽样；执行适用的安全和认证检查 |
| 依赖、构建、CI、全局配置 | `release:verify` | 核对 CI、Vercel 和相应运行时结果 |
| 域名、OAuth、第三方集成 | `release:verify` + 专项测试 | 必须验证真实端到端信号 |

所有行为改动先运行定向红测和绿测，再选择上表的一次风险门禁。低风险改动不在本地和 CI 重复运行完整 `verify`；不要叠加 `check:fast`、`check:content`、`check:ui`、独立 Build 和 `release:verify`。范围扩大、定向检查失败、风险不确定或跨多个风险类别时升级到 `release:verify`。CI/分类器/构建链调整自身始终是高风险，过渡期仍完整验证。

标准门禁因端口、进程或平台问题无法执行时，先安全排查一次；仍不能运行则用覆盖缺失范围的等价验证补齐，并明确环境和剩余限制。已经充分覆盖的部分不重复执行；Windows 本地通过不代表 Linux/macOS 已验收。

`verify` 和 `verify:deploy` 先执行 `lint:code`，类型检查由随后 `build` 中的一次 `astro check` 承担。单独执行 `lint` 或 `build` 仍会检查类型。独立目标产物验证检查不同的路由、依赖和运行环境边界，不能用组合站点 Build 代替；仅构建受影响的目标，且同一工作区的 Astro 构建必须串行。

验证别名共用 Node 执行器，逐步执行并在首次失败时停止，不依赖 PowerShell、Bash 或盘符。`node scripts/verify.mjs content --plan` 可只读查看步骤（其他模式为 fast/ui/full/release/deploy）。本地验证入口将单元测试和 E2E 并发限制为 2，CI 保留原并发配置和全部断言；没有跳过检查的开关。`check:content` 不再构建私有 App/API；CI 内容路径继续由独立必需产物门禁构建 Site，避免同一 CI 任务重复构建。

E2E 使用 `scripts/test-server.mjs` 启动独占的本地 Astro 服务；文件监听排除忽略的工具归档和构建/测试产物，仍监听真实源码。测试服务关闭 Astro 开发工具栏及其后台抓取，产品页面和独立 axe 全站/404 审计继续运行。端口隔离、不复用未知服务、全部浏览器断言与超时保持不变。

## 抽查标准

- Schema、URL、字段存在性、状态数量等可程序化约束，对全部改动记录执行检查，不抽样。
- 同一模板影响多个页面时，视觉上至少检查 1 个正向页面和 1 个负向页面；正向页面应出现目标行为，负向页面应保持不变。
- 只检查受影响的代表模板；全局 UI 影响首页、工具页、Blog 时覆盖这三类及桌面/移动端。低风险局部样式检查一个代表页面的桌面/移动和一个负向区域即可。
- 内容批量发布时，所有新增 URL 做 HTTP/标题/H1 检查，浏览器重点抽查第一篇、最后一篇和结构最复杂的一篇。
- 图片链路至少抽查 Blog 与工具页各一张，并验证 `<picture>`、WebP `srcset`、原图 fallback 和尺寸信息。
- 鉴权、对象归属、越权、安全头和第三方真实业务信号不能用代表页面抽查代替。
- 所有内容、路由或数据记录实际变化的 URL 做只读 HTTP 检查；共享 CSS/组件的所有引用路由不自动算作改动 URL。低风险 UI 上线后确认部署绑定预期 SHA，再检查正向页面和负向区域。
- 未受影响的域名、证书、OAuth、R2、CORS、Provider 和 Production Smoke 标记为 `not applicable`；不为凑齐通过而调用真实服务。

### 运维人员

环境变量或域名变更后先运行无成本的 `npm run test:smoke:production`。R2、CORS、鉴权、Provider 或功能链路变更时，只运行受影响操作的认证功能验收，不用背景移除的结果代替图片去水印或视频验收。

- 六类现行操作（含背景/物体）：通过本机环境设置 `PROCESSING_ACCEPTANCE_SESSION_COOKIE`，按 [Worker 部署说明](product/WORKER_DEPLOYMENT.md#发布验收与恢复操作) 确认操作、样本、报价金额/单位和调用预算，再运行 `--functional` 一次。
- 功能验收会创建临时对象并消耗额度。缺少认证或预算时不得记为通过；提交结果不明确时查询原任务，不重新提交。

只有涉及生产环境/域名的变更才要求重新运行公开 Production Smoke；R2、CORS、鉴权、Provider 或处理链路变更运行匹配操作的认证功能验收一次，不循环收费重试。新建或修改处理操作还须操作级浏览器测试和部署后一次手动功能验收。定时 smoke 保持公开只读；重复 Provider 成本必须另获授权。适用的认证或 Provider 验收未执行时是阻塞项，不能标记通过。支付和第三方集成还须各自真实信号，不能用脚本存在、按钮显示或 HTTP 200 代替。

### 测试去重边界

内容 schema、安全规则、独立 SEO 基线、厂商协议与金融恢复测试保留。旧执行链专属测试随退役代码移除；现行价格、预算授权、收费幂等、归属、PNG/视频产物和 UNKNOWN 恢复仍由 v1/Worker 测试覆盖。`site-visual-system.test.ts` 维护视觉 token 和尚无等价覆盖的样式约束；首页模块、工具/指南数量和轮播行为由 `site-quality.spec.ts` 验证，图片框架由 `image-display-frames.spec.ts` 验证，不再为相同行为重复锁定源码类名或库的 import 写法。

## 自动化保护

- `.github/workflows/ci.yml`：每次 PR 和 `main` 推送始终运行 `verify` 作业，以事件的 base/head SHA 分类并重新计算实际执行范围；不使用 workflow 路径过滤跳过必需检查。文档只检查 diff；纯 Blog/landing 与原始栅格图检查 schema、内容测试与变更内容安全；明确的公共样式先生成响应图片再运行 `check:ui`；其他范围运行依赖审计和完整 `verify`。高风险/未知/混合、空 diff 或读取 diff 失败一律完整验证。源码、MDX、SVG、站点身份设置、基线单独修改和内容 API 协议不进入内容快路径。
- `.github/workflows/build-targets.yml`：同一份变更分类选择 Site、App 和 Worker，生成并验证对应产物。内容变更只选择 Site；Worker 入口只选择 Worker；共享处理代码选择 App 和 Worker；依赖与构建入口选择全部目标。Worker 验证真实打包和七文件上传上下文，不部署或调用 Provider。
- `.github/workflows/production-smoke.yml`：每天只运行无成本 Public Smoke；手工选择 operation 时才运行会消耗额度的 Functional Smoke。
- `.github/workflows/cms-content-check.yml`：仅保留显式手动诊断，不再在 main 重复执行已由必需 CI 覆盖的内容同步。
- 内容 lane 的 `content-ci.test.ts` 从事件固定 base/head Git 对象读取实际变更，以真实 base 记录检查只读 legacy comparison，不能用候选与自身比较；对栅格图做原始字节解码，API 素材额外核对记录的尺寸、格式和限制。草稿、URL、引用与保留 slug 仍由全内容 schema/发布规则和 Site 构建检查，坏 JSON 可能阻断整站。
- 单个新建 `.content-api/{id}.json` 仅在可信 base 中不存在该 ID、严格结构、真实 Git 普通文件、逐项内容/素材闭包、字节哈希和重算 digest 均匹配时随内容进入同一 lane。修改已有审计 ID 一律完整检查，保留历史发布证明和恢复锚。预安装分类只使用 Node 内建模块；安装后内容安全/图片解码仍必须成功。删除、rename、symlink、额外路径、多个审计、无法读取、未知或混合范围升级完整检查。实际执行重新核对同一事件 SHA 对，不信任 label、actor 或自报检查结果。
- 独立内容基线与其保护记录继续使用完整检查；不为追求快路径豁免基线。审计里的批准文本仅是记录，不能替代内容负责人具体差异审阅、API 发布验证或受保护 main；本阶段不改变 Token 权限、审批或 required context。
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
