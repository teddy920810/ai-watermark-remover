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

Astro 负责内容路由和服务端 API；React 只用于上传交互岛。浏览器先请求预签名地址，再直接上传到私有 R2，避免图片经过 Vercel 函数。任务状态保存在 R2，处理能力通过 `WatermarkProvider` 接口隔离。

当前 `MockWatermarkProvider` 仅复制对象。接入真实服务时，实现 `src/lib/providers/watermark-provider.ts` 的契约并在 `src/lib/services.ts` 注入，不要改变公开 API 响应格式。选择和预览图片无需登录；创建与查询任务必须有有效会话，并且任务只能由其 `ownerId` 对应的用户读取。

## 内容模型

- 博客 schema：`src/content.config.ts`，文件位于 `src/content/blog/`。
- 落地页 schema：同上，文件位于 `src/content/landing-pages/`。
- CMS 表单：`.pages.yml`。

新增或调整字段必须同步修改 Astro schema、Pages CMS 配置、页面渲染组件及测试。Pages CMS 的 `merge: true` 会保留表单未管理的字段；不要移除这一设置。

博客 Markdown 正文中的相对图片如果尚未提交，构建会跳过该图片并输出 `[content] Missing blog image omitted` 警告，避免单张正文配图阻塞整站发布。其他内容 schema 仍严格校验；封面图等 CMS 图片应继续通过 `public/uploads`（页面路径 `/uploads`）管理。

Pages CMS 上传的 PNG/JPG 会在 `prebuild` 阶段自动生成 480、768、1200 px（不放大原图）的 WebP 衍生图。CMS 内容仍保存原始 `/uploads/...` 路径，页面通过 `<picture>` 优先提供 WebP 并保留原图回退；不要删除原始运营图片。SVG、GIF 和已是 WebP 的资源不会再次转换，生成目录 `public/generated/` 不提交到 Git。

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

