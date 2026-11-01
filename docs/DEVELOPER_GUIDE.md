# 开发者指南

## 环境准备

- Node.js 22 LTS（项目支持 `^22.22.3 || ^24.16.0`）
- npm 10 或更高版本
- Git
- Cloudflare R2 与 Vercel 项目权限（仅在调试线上资源时需要）

```sh
git pull --ff-only origin main
npm ci
node -e "require('node:fs').copyFileSync('.env.example','.env.local',require('node:fs').constants.COPYFILE_EXCL)"
npm run dev
```

`.env.local` 只保存本机密钥且已被 Git 忽略。真实凭据由管理员通过密码管理器等安全渠道提供。

Google 登录还需要：

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `BETTER_AUTH_SECRET`（至少 32 字节随机值）
- `BETTER_AUTH_URL`（本地测试为 `http://localhost:4321`）

可运行 `npm run auth:import -- "Google OAuth JSON 路径"` 安全导入本地凭据。原始 JSON 会保存在被 Git 忽略的 `.secrets/`，不得提交或复制到浏览器代码。Google Cloud 本地回调为 `http://localhost:4321/api/auth/callback/google`。

## 应用结构

当前操作、协议、数据与文档权威入口见[当前架构](CURRENT_ARCHITECTURE.md)和[总索引](INDEX.md)。每次从已登记维护根目录启动，先运行`npm run project:check -- --read-only`；既有改动分类后用`--classified <本机JSON>`核对。路径登记使用本机环境/已有Codex registry，不写进产品运行依赖。

Astro 负责内容路由和服务端 API；React 只用于上传交互岛。浏览器先请求预签名地址，再直接上传到私有 R2，避免图片经过 Vercel 函数。任务状态保存在 R2；去水印能力通过 `WatermarkProvider` 接口隔离，背景移除通过独立的 `BackgroundRemovalProvider` 接口隔离，物体移除通过 `ObjectRemovalProvider` 隔离，三种任务共用账户权益账本。新背景与物体客户端已逐项接入共同耐久协调器和Worker；旧API的准入、查询、下载和已接受请求继续兼容，费用/PNG/选区与恢复规则见[图片操作规范](product/IMAGE_OPERATIONS.md)。

新图片/视频工作区位于 `/app/image`、`/app/video`，使用 `/api/v1` 报价、任务和临时下载接口。非收费媒体检查和已确认任务由独立 Worker 执行，金融预留和耐久 outbox 在 PostgreSQL，媒体与权威任务状态在私有 R2。PRO、精修、视频使用独立的管理员处理额度；旧免费次数、旧 API 和其他工具保持兼容。

新处理配置见 [配置说明](product/PROCESSING_CONFIGURATION.md)，独立 Web 构建见 [部署目标](../apps/DEPLOYMENT_TARGETS.md)，Worker、R2 清理和真实验收见 [部署说明](product/WORKER_DEPLOYMENT.md)。新账号和再次登录的稳定归属见 [Google 账户身份](ACCOUNT_IDENTITY.md)。现行规范从 [总索引](INDEX.md) 进入；重构阶段与原始验收见 [重构台账](product/REFACTOR_LEDGER.md)，后续交付见 [发布记录](product/RELEASE_READINESS.md)。原 [T0–T11 TODO](product/IMPLEMENTATION_TODO.md) 为历史记录，不能继承其中预算或测试结果。

当前 `MockWatermarkProvider` 仅复制对象。接入真实服务时，实现 `src/lib/providers/watermark-provider.ts` 的契约并在 `src/lib/services.ts` 注入，不要改变公开 API 响应格式。选择和预览图片无需登录；创建与查询任务必须有有效会话，并且任务只能由其 `ownerId` 对应的用户读取。

仓库提供 Dewatermark v3 Provider，按官方契约把服务端读取的图片归一化为最大边不超过 6000px 的 JPEG，再把 Base64 结果写回私有 R2。本地和测试环境默认配置仍是 `WATERMARK_PROVIDER=mock`；生产环境只有在 Key 校验、授权样图效果和真实端到端链路通过后，才通过服务端环境变量切换为 `dewatermark`。官方契约见 <https://dewatermark.ai/api-document>。

背景移除使用 Replicate 上的 `851-labs/background-remover` 社区模型，并固定模型版本以避免上游无提示漂移。服务端把私有 R2 输入转换成短期签名链接，按供应商契约请求 RGBA PNG，再校验输出域名、体积和 PNG 文件签名后写回私有 R2。浏览器不会收到 `REPLICATE_API_TOKEN`。配置该 Token 后会自动选择 Replicate；测试或离线开发可显式设置 `BACKGROUND_REMOVAL_PROVIDER=mock` 覆盖。模型契约见 <https://replicate.com/851-labs/background-remover/api>，社区模型版本说明见 <https://replicate.com/docs/topics/models/community-models/>。

物体移除使用 Replicate 上的 `allenhooo/lama` 社区模型并固定版本。浏览器只生成蓝色半透明预览层，提交时导出与原图同尺寸的黑白 PNG mask（黑色保留、白色移除）；服务端再次验证归属、类型、尺寸和非空选择，再把归一化后的原图与 mask 通过短期签名链接交给 Replicate。测试或离线开发可显式设置 `OBJECT_REMOVAL_PROVIDER=mock`。模型契约见 <https://replicate.com/allenhooo/lama/api>。

本地凭据导入和只读检查：

```sh
npm run processing:import -- dewatermark.txt nero.txt S3-info.txt
npm run processing:check
```

第三个参数是可选的；提供时会从带标签的 Cloudflare S3 信息文件导入 R2 Account ID、Access Key、Secret、Endpoint 和 `watermark` Bucket。导入脚本只更新被 Git 忽略的 `.env.local`，不会自动启用真实 Provider。检查脚本查询 Dewatermark credit 余额并对 Neon 执行 `SELECT 1`，不会提交图片、创建数据库表或消耗图片 credit。

首次部署权益功能前运行：

```sh
npm run db:migrate
```

迁移脚本读取 `db/migrations`，在 Neon 事务和 advisory lock 内只执行尚未登记的版本。Neon 保存 Google 授权返回的基础资料，以及首次 1 次、每日签到 +1、余额上限 3、任务扣减/失败退回账本及最近活跃时间。Google OAuth token 不写入资料表；图片、结果及 MVP 任务状态仍保存在私有 R2。

## 内容模型

SEO 运营 Agent 的服务端入口与部署前置见 [内容 API](CONTENT_API.md)。API 和 Astro 共用 `src/lib/content/entry-schemas.ts`；模板仍取自 `cms-templates/`，纯文档解析/发布规则位于 `scripts/lib/cms-*`。内容/运营素材持久到 Git 内容分支，不能写部署临时磁盘或借用用户 R2 上传接口。内容 Token 与仓库专用凭据分开，部署到 App；Site 只生成静态页面和不含秘密的发布 digest 证明。

正式 PayPal 图片 Credits 的配置、批次账本、退款来源和 Web/Worker 发布顺序见 [PayPal 发布说明](PAYPAL_LIVE_RELEASE.md)。启用前先执行新增支付迁移，再更新支持 `purchasedImageCredits` 的既有 Worker，最后开启 Web 的已购额度与新收款；不要把旧 Sandbox 身份切换或测试部署覆盖到当前正式架构。运行中的已接受任务按原预留金额结算；暂停新购买时保留已购额度开关与明确的操作费率。

- 博客 schema：`src/content.config.ts`，文件位于 `src/content/blog/`。
- 落地页 schema：同上，文件位于 `src/content/landing-pages/`。
- CMS 表单：`.pages.yml`。

新增或调整字段必须同步修改 Astro schema、Pages CMS 配置、页面渲染组件及测试。Pages CMS 的 `merge: true` 会保留表单未管理的字段；不要移除这一设置。

博客 Markdown 正文中的相对图片如果尚未提交，构建会用全站占位图替换并输出警告。首页、工具页、Blog、站点 Logo 等 CMS 图片引用缺失时同样使用 `/images/image-placeholder.svg`，内容校验只告警而不阻塞发布；浏览器还会为网络加载失败和动态图片提供同一回退。其他内容 schema 仍严格校验；封面图等 CMS 图片应继续通过 `public/uploads`（页面路径 `/uploads`）管理。

Pages CMS 上传的 PNG/JPG 会在 `prebuild` 阶段自动生成 480、768、1200 px（不放大原图）的 WebP 衍生图。CMS 内容仍保存原始 `/uploads/...` 路径，页面通过 `<picture>` 优先提供 WebP 并保留原图回退；不要主动删除仍在使用的原始运营图片。若运营误删被引用资源，页面会显示代码内置占位图且构建继续，日志会保留缺失路径供后续修复。SVG、GIF 和已是 WebP 的资源不会再次转换，生成目录 `public/generated/` 不提交到 Git。

### 从审核后的 Word 快速导入博客

审核稿使用一个 H1 标题、紧随其后的摘要、H2/H3 正文、Word 表格和 Caption 图片说明。运行跨平台导入命令后，会生成 Pages CMS 兼容的 Markdown、保留原始图片字节，并把单列表格转成 quote、多列表格转成 Markdown table：

```sh
npm run blog:import-docx -- --input "审核稿.docx" --slug "how-to-remove-example-watermark" --seo-title "SEO title" --published-at "2026-08-23"
```

导入器会拒绝已存在的 slug，避免覆盖已发布博客。导入后仍需运行内容校验、检查图片与来源、在浏览器抽查最终页面，并按正常 PR 流程发布。

## R2 约束

- Bucket：`watermark`，保持私有。
- 客户端只接收短期预签名 URL，不得获得 R2 密钥。
- CORS 只允许明确的生产/预览/本地来源及必要方法。
- 旧`uploads/results/jobs`按一天生命周期；新媒体只配置四个精确前缀，恢复控制记录不设全局TTL。完整来源与回读边界见[Worker规范](product/WORKER_DEPLOYMENT.md#媒体过期与控制记录)。
- 日志不得输出签名 URL、密钥或完整用户图片内容。

## 测试与发布

```sh
npm run check:fast       # 普通小改：内容同步 + 全部单元测试
npm run check:content    # CMS、Blog、落地页、图片：内容测试 + Build
npm run check:ui         # 布局、样式、公共 UI：相关测试 + 公共页面 E2E
npm run release:verify   # 高风险改动：依赖审计 + 站点校验 + 完整 verify
```

所有行为变化先运行定向红测和绿测。本地根据改动范围选择上面的检查；PR CI 的稳定必需检查按明确允许名单选择范围，未知/混合或高风险改动运行完整 `npm run verify`，门禁必须成功后才能合并 `main`。API、鉴权、R2、Provider、安全策略、依赖、构建或 CI 修改必须在本地运行 `release:verify`。视觉验收应抽查代表模板的桌面与移动端，并同时检查一个应出现目标行为的正向页面和一个不应出现的负向页面。

完整门禁的类型检查只在 Build 中执行一次；单独 `lint` 和 `build` 仍各自包含类型检查。Site/App/Worker 的独立构建入口、受影响目标和产物验收统一见 [测试与质量指南](TESTING_GUIDE.md#自动化保护) 与 [部署目标](../apps/DEPLOYMENT_TARGETS.md)，不要把 Worker 源码测试当作真实打包或生产执行的证据。

Pages CMS在内容分支保存，经受保护PR与必需CI后进入`main`；模板工作流只创建审核分支和草稿PR。推送前执行`git fetch origin main`检查分歧；如远端领先，先安全rebase/merge，禁止force push。合并后Vercel按目标独立发布。

### 合并后的分支收尾

本仓库启用 GitHub 原生 **Automatically delete head branches**（`delete_branch_on_merge`）。它只删除合并后的远端引用，不改本地分支、工作树或未提交文件；本地暂时占用不应成为普通 feature 远端永久保留的理由。保护规则仍优先；fork PR 取决于来源仓库设置和合并者权限，不能保证自动删除。[GitHub 官方合同](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-the-automatic-deletion-of-branches)。

PR owner 在本次交付验收后负责收尾：

1. 核对同仓库 PR 确实 `merged`、目标为 `main`、原 head 完整 SHA 与待删引用相同，并确认权威 merge SHA 已进入最新 `origin/main`。`closed` 不等于合并；squash 来源不一定是 main 祖先，不能仅用 `git branch --merged` 判断。正常 squash 可比较来源 head 与该 merge 的完整 tree；不一致时先查明差异再决定。
2. 保留精确 head 的可恢复对象：删除前创建并 `verify`/`list-heads` 核对 Git bundle，或核对已经完整覆盖该 head 的现有恢复包。不能只记 SHA 后依赖未来垃圾回收仍保留对象；不打包未提交文件或凭据。
3. 回读远端引用；原生已删除则记录完成，不重建。遗留远端先核对保护、其他开放 PR 和真实恢复依赖；只有明确授权的单条引用才能用完整 expected SHA 的 lease 删除，不附带 tags、mirror 或 submodule 推送。未知、换头、失败均停下核对，不自动扩展清理范围。
4. 本地由 owner 释放占用后再清理。检查全部 `git worktree list --porcelain`、开放 PR 与依赖；默认/保护分支、符号引用、其他 owner、夹具和具名保留项不得删除。唯一写入时段内再次核对，然后以 expected SHA 做条件删除，不使用无条件 `branch -D`、reset、stash、全仓 prune 或目录删除。

以下跨平台命令仅演示单条本地收尾。先把示例分支和 `EXPECTED_SHA` 换成已审阅值，按上述前提执行；任何非零结果都停止，不清锁或循环重试：

```sh
git worktree list --porcelain
git for-each-ref --format="%(refname) %(objectname) %(symref)" refs/heads/codex/example
git bundle create --version=3 output/branch-example.bundle refs/heads/codex/example
git bundle verify output/branch-example.bundle
git bundle list-heads output/branch-example.bundle
git update-ref --no-deref -d refs/heads/codex/example EXPECTED_SHA
```

删除后核对精确 before/after 引用集合并报告 owner 收尾结果；本地仍占用则具名记录待释放，不阻塞远端原生删除。新工作从最新 main 开新分支。保留项及到期复核见[兼容与退出](COMPATIBILITY.md#分支与工作树保留项)；到期只触发复核，不自动删除，也不授权定时全仓清理。

原内容独立基线不自动随CMS保存更新。受保护的既有内容需要内容负责人先明确授权具体PR差异，维护者再运行`node scripts/update-content-baseline.mjs --approval APPROVED_PR_URL EXACT_CONTENT_PATH`，把fixture变化一并提交原PR审阅。该命令只更新测试预期，不改内容；填写PR链接本身不授予内容修改权限。新建草稿仍受草稿、模板文本、URL和图片检查约束。

获授内容权限的运营 Token 持有人也可通过内容 API 的显式 review 操作批准当前 digest 对应的具体差异；服务端记录 PR 审计评论，只同步本次批准涉及的既有基线记录，并把内容、素材、基线留在同一 PR 供审阅。普通保存不更新基线，后续编辑撤销批准；发布前再核对批准评论、素材哈希与基线范围。研发验收草稿不等于内容负责人批准，不能因此改动既有内容值。

