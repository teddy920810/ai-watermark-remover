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

免费 Gemini 本地工具位于 `/app/free/gemini`，图片/MP4 在浏览器 Worker 处理。引擎固定版本、显式维护命令、原文件付费交接和验收边界见[免费 Gemini](product/FREE_GEMINI.md)；生产登录、付费与分析验收单列，不通过客户端跳过登录来替代。

Google 登录还需要：

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `BETTER_AUTH_SECRET`（至少 32 字节随机值）
- `BETTER_AUTH_URL`（本地测试为 `http://localhost:4321`）

可运行 `npm run auth:import -- "Google OAuth JSON 路径"` 安全导入本地凭据。原始 JSON 会保存在被 Git 忽略的 `.secrets/`，不得提交或复制到浏览器代码。Google Cloud 本地回调为 `http://localhost:4321/api/auth/callback/google`。

## 应用结构

当前操作、协议、数据与文档权威入口见[当前架构](CURRENT_ARCHITECTURE.md)和[总索引](INDEX.md)。每次从已登记维护根目录启动，先运行`npm run project:check -- --read-only`；既有改动分类后用`--classified <本机JSON>`核对。路径登记使用本机环境/已有Codex registry，不写进产品运行依赖。

Astro 负责静态内容和 v1 服务端 API；React 承接交互工作区。浏览器先请求预签名地址，再直接上传到私有 R2。六类处理共用 v1 报价、明确确认和独立 Worker，费用、PNG、选区与恢复规则见[图片操作规范](product/IMAGE_OPERATIONS.md)。旧上传、`/api/jobs` 与 JobService 在本地第三批退役，部署状态另见发布记录。

新图片/视频工作区位于 `/app/image`、`/app/video`，使用 `/api/v1` 报价、任务和临时下载接口。非收费媒体检查和已确认任务由独立 Worker 执行，金融预留和耐久 outbox 在 PostgreSQL，媒体与权威任务状态在私有 R2。新账户与已审核升级的账户可使用统一 Credits；旧账户、旧单位和已接受任务继续兼容。仓库开关默认关闭，实际启用、逐账户转换和来源账本见 [Credits 合同](PROCESSING_CREDITS.md)与[发布记录](product/RELEASE_READINESS.md)。

新处理配置见 [配置说明](product/PROCESSING_CONFIGURATION.md)，独立 Web 构建见 [部署目标](../apps/DEPLOYMENT_TARGETS.md)，Worker、R2 清理和真实验收见 [部署说明](product/WORKER_DEPLOYMENT.md)。新账号和再次登录的稳定归属见 [Google 账户身份](ACCOUNT_IDENTITY.md)。现行规范从 [总索引](INDEX.md) 进入；重构阶段与原始验收见 [重构台账](product/REFACTOR_LEDGER.md)，后续交付见 [发布记录](product/RELEASE_READINESS.md)。原 [T0–T11 TODO](product/IMPLEMENTATION_TODO.md) 为历史记录，不能继承其中预算或测试结果。

本地 `PROCESSING_PROVIDER=mock` 使用当前耐久管线的模拟实现。真实去水印由 `src/lib/runtime/processing-provider.ts` 与 `dewatermark-client.ts` 实现，背景/物体由 `replicate-image-provider.ts` 实现；它们共用 `WatermarkProvider` 的 submit/poll 边界。选择和预览无需登录，所有私有媒体、任务和下载仍须校验当前用户归属。

仓库提供 Dewatermark v3 Provider，按官方契约把服务端读取的图片归一化为最大边不超过 6000px 的 JPEG，再把 Base64 结果写回私有 R2。本地和测试环境默认配置仍是 `PROCESSING_PROVIDER=mock`；生产环境只有在 Key 校验、授权样图效果和真实端到端链路通过后，才通过服务端环境变量切换为 `dewatermark`。官方契约见 <https://dewatermark.ai/api-document>。

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

迁移脚本读取 `db/migrations`，在 Neon 事务和 advisory lock 内只执行尚未登记的版本。Neon 保存 Google 授权返回的基础资料、旧权益和统一 Credits 的来源/预留/结算账本及最近活跃时间。旧账户的首次 1 次、每日签到 +1 和免费奖励上限 3 继续兼容；统一 Credits 的奖励与费率以当前合同为准。数据库结构升级不会自动转换旧账户。Google OAuth token 不写入资料表；图片、结果及 MVP 任务状态仍保存在私有 R2。

## 内容模型

法律正文位于 `src/content/legal/`，由受信任的 CMS/Git 编辑者经受保护发布流程维护。现有 Markdown 编译管线的 `safeLegalMarkdown` 仅约束该目录：拒绝原始 HTML，链接只接受 HTTPS、mailto、站内绝对路径及锚点；代码块和行内代码仍按文本显示。不要把内容 API 的 Blog/landing 校验当作法律页已受保护，也不要为法律文本引入可执行 MDX。

所有 `SiteLayout` 的 JSON-LD 在最终 `set:html` 输出处使用 `serializeJsonLd`，将 JSON 中的 `<` 转为 `\u003c`，避免元数据提前结束 script 节点；解析后的字段值保持不变。新增 schema 继续通过这一共享边界，不直接拼接 JSON 或以 HTML 实体替代 JSON 转义。规则依据见 [Astro Markdown 插件](https://docs.astro.build/en/guides/markdown-content/#markdown-plugins)和 [HTML script 内容限制](https://html.spec.whatwg.org/multipage/scripting.html#restrictions-for-contents-of-script-elements)。

SEO 运营 Agent 的服务端入口与部署前置见 [内容 API](CONTENT_API.md)。API 和 Astro 共用 `src/lib/content/entry-schemas.ts`；模板仍取自 `cms-templates/`，纯文档解析/发布规则位于 `scripts/lib/cms-*`。内容/运营素材持久到 Git 内容分支，不能写部署临时磁盘或借用用户 R2 上传接口。内容 Token 与仓库专用凭据分开，部署到 App；Site 只生成静态页面和不含秘密的发布 digest 证明。

正式 PayPal 图片 Credits 的配置、批次账本、退款来源和 Web/Worker 发布顺序见 [PayPal 发布说明](PAYPAL_LIVE_RELEASE.md)。启用前先执行新增支付迁移，再更新支持 `purchasedImageCredits` 的既有 Worker，最后开启 Web 的已购额度与新收款；不要把旧 Sandbox 身份切换或测试部署覆盖到当前正式架构。运行中的已接受任务按原预留金额结算；暂停新购买时保留已购额度开关与明确的操作费率。

- 博客 schema：`src/content.config.ts`，文件位于 `src/content/blog/`。
- 落地页 schema：同上，文件位于 `src/content/landing-pages/`。
- CMS 表单：`.pages.yml`。

新增或调整字段必须同步修改 Astro schema、Pages CMS 配置、页面渲染组件及测试。Pages CMS 的 `merge: true` 会保留表单未管理的字段；不要移除这一设置。

博客 Markdown 正文中的相对图片如果尚未提交，构建会用全站占位图替换并输出警告。首页、工具页、Blog、站点 Logo 等 CMS 图片引用缺失时同样使用 `/images/image-placeholder.svg`，内容校验只告警而不阻塞发布；浏览器还会为网络加载失败和动态图片提供同一回退。其他内容 schema 仍严格校验；封面图等 CMS 图片应继续通过 `public/uploads`（页面路径 `/uploads`）管理。

Pages CMS 上传的 PNG/JPG 会在 `prebuild` 阶段自动生成 480、768、1200 px（不放大原图）的 WebP 衍生图。CMS 内容仍保存原始 `/uploads/...` 路径，页面通过 `<picture>` 优先提供 WebP 并保留原图回退；不要主动删除仍在使用的原始运营图片。若运营误删被引用资源，页面会显示代码内置占位图且构建继续，日志会保留缺失路径供后续修复。SVG、GIF 和已是 WebP 的资源不会再次转换，生成目录 `public/generated/` 不提交到 Git。

图片生成器将结果缓存在已被 Git 和部署上传忽略的 `.vercel/cache/optimized-images/`。缓存键包含原图字节的 SHA-256、实际宽度、resize/WebP 参数、生成器源码摘要、Sharp/底层编码库版本及平台架构；同名替换或编码合同升级会重新生成。每个缓存衍生图读取时核对 SHA-256，缺失、损坏或无效清单只重算受影响结果。每次构建都会重新写入当前所需的公开衍生图，并删除已无原图或不再需要的宽度；原图、内容 URL、alt 和编码默认值不变。日志分别报告编码、复用数量和图片阶段耗时，原有内容、响应图片和发布检查继续执行，无 CMS 字段迁移。

该目录是可丢弃的构建缓存；移除后下次自动冷构建，历史缓存不自动清理。GitHub 在 `CI / verify` 的 full/ui 路径和独立 Site 构建中用固定 SHA 的官方 cache v6 action 分开恢复、保存；路径只包含公开图片衍生图及校验清单，不缓存凭据、原始业务数据或整个 `.vercel`。外层键隔离系统、架构、Node 主版本、锁文件/生成器版本和提交，前缀恢复历史结果后仍逐图验证内容；沿用 GitHub 的默认分支/PR 缓存可见性，不跨系统归档。缓存未命中或图片缓存缺损时冷构建；保留官方动作的错误处理，不设置忽略步骤失败，验证、产物上传和必需门禁照常执行。精确命中不重复上传未变缓存；同 SHA 作业重跑重新验证并替换同名产物，不能以旧产物冒充通过。

Vercel Git 构建按[官方合同](https://vercel.com/docs/deployments/troubleshoot-a-build#what-is-cached)自动保留仓库根目录 `.vercel/cache`，在安装/构建前恢复、成功后保存；适用于当前 `apps/site`、Other preset，无需新增服务、环境变量或改写部署方式。App 不生成这批响应图片，两个目标的现有检查和边界不变。构建缓存不进入公开静态目录或 Worker 上传上下文。远端收益须从同一代码与数据的冷暖作业/部署日志测量恢复、构建、缓存创建/上传及总耗时；不把图片阶段或本机耗时当作完整构建收益。不要清除全项目缓存来制造对比；图片缓存首次接入自然冷启动，再用同 SHA 的一次重跑/预览重部署验证暖缓存。

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

所有行为变化先运行定向红测和绿测，再按[唯一验证矩阵](TESTING_GUIDE.md#动态验证矩阵)选择一次检查。该指南统一维护命令、CI、视觉抽查和真实功能验收要求，本页不复制矩阵。

Site/App/Worker 的构建入口、路由和产物合同见[部署目标](../apps/DEPLOYMENT_TARGETS.md)。构建准备只在 Astro 的 `astro:config:setup` 生命周期执行；配置读取和目标构建调度不清理目录。生成目录白名单、符号链接检查和独立目标隔离继续生效。

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

