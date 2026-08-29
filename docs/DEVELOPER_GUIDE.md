# 开发者指南

## 环境准备

- Node.js 22 LTS（项目支持 `>=22.12.0 <25`）
- npm 10 或更高版本
- Git
- Cloudflare R2 与 Vercel 项目权限（仅在调试线上资源时需要）

```sh
git pull --ff-only origin main
npm ci
copy .env.example .env.local
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

Astro 负责内容路由和服务端 API；React 只用于上传交互岛。浏览器先请求预签名地址，再直接上传到私有 R2，避免图片经过 Vercel 函数。任务状态保存在 R2；去水印能力通过 `WatermarkProvider` 接口隔离，背景移除通过独立的 `BackgroundRemovalProvider` 接口隔离，两种任务共用账户权益账本。

当前 `MockWatermarkProvider` 仅复制对象。接入真实服务时，实现 `src/lib/providers/watermark-provider.ts` 的契约并在 `src/lib/services.ts` 注入，不要改变公开 API 响应格式。选择和预览图片无需登录；创建与查询任务必须有有效会话，并且任务只能由其 `ownerId` 对应的用户读取。

仓库提供 Dewatermark v3 Provider，按官方契约把服务端读取的图片归一化为最大边不超过 6000px 的 JPEG，再把 Base64 结果写回私有 R2。本地和测试环境默认配置仍是 `WATERMARK_PROVIDER=mock`；生产环境只有在 Key 校验、授权样图效果和真实端到端链路通过后，才通过服务端环境变量切换为 `dewatermark`。官方契约见 <https://dewatermark.ai/api-document>。

背景移除使用 Replicate 上的 `851-labs/background-remover` 社区模型，并固定模型版本以避免上游无提示漂移。服务端把私有 R2 输入转换成短期签名链接，按供应商契约请求 RGBA PNG，再校验输出域名、体积和 PNG 文件签名后写回私有 R2。浏览器不会收到 `REPLICATE_API_TOKEN`。配置该 Token 后会自动选择 Replicate；测试或离线开发可显式设置 `BACKGROUND_REMOVAL_PROVIDER=mock` 覆盖。模型契约见 <https://replicate.com/851-labs/background-remover/api>，社区模型版本说明见 <https://replicate.com/docs/topics/models/community-models/>。

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
- `uploads/`、`results/`、`jobs/` 配置 1 天生命周期删除规则。
- 日志不得输出签名 URL、密钥或完整用户图片内容。

## 测试与发布

```sh
npm run check:fast       # 普通小改：内容同步 + 全部单元测试
npm run check:content    # CMS、Blog、落地页、图片：内容测试 + Build
npm run check:ui         # 布局、样式、公共 UI：相关测试 + 公共页面 E2E
npm run release:verify   # 高风险改动：依赖审计 + 站点校验 + 完整 verify
```

所有行为变化先运行定向红测和绿测。本地根据改动范围选择上面的检查；PR CI 仍会运行完整 `npm run verify`，且必须成功后才能合并 `main`。API、鉴权、R2、Provider、安全策略、依赖、构建或 CI 修改必须在本地运行 `release:verify`。视觉验收应抽查代表模板的桌面与移动端，并同时检查一个应出现目标行为的正向页面和一个不应出现的负向页面。

Pages CMS 可能随时提交到 `main`。推送前执行 `git fetch origin main` 并检查分歧；如远端领先，先安全 rebase/merge，禁止 force push。合并到 `main` 后 Vercel 自动发布。

