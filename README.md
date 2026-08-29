# ClearMark AI / Watermark Gemini

ClearMark AI 是部署在 [www.watermarkgemini.com](https://www.watermarkgemini.com) 的图片水印处理 MVP。项目采用 Astro、React、Vercel 与私有 Cloudflare R2，并通过 Pages CMS 让非技术成员直接维护博客和 SEO 落地页。

本仓库也可作为同类站点框架完整 fork：WatermarkGemini 内容继续保留在当前仓库，新站在自己的仓库中初始化品牌并通过 Pages CMS 重建内容。操作见 [新站模板指南](docs/TEMPLATE_GUIDE.md)。

> 当前状态：匿名用户可以选择和预览图片，创建处理任务时需要通过 Google 登录。首次登录获得 1 次免费处理，每日签到增加 1 次，免费余额上限为 3 次；去水印和背景移除共用这份余额。上传、临时存储和任务流程已经可用；生产环境可分别通过服务端配置启用 Dewatermark v3 去水印 Provider 和 Replicate 851 Labs 背景移除 Provider，本地和测试环境默认仍使用 Mock Provider。

## 常用入口

- 正式站点：[www.watermarkgemini.com](https://www.watermarkgemini.com)
- GitHub：[teddy920810/ai-watermark-remover](https://github.com/teddy920810/ai-watermark-remover)
- 内容后台：[Pages CMS](https://app.pagescms.org)
- 部署平台：[Vercel](https://vercel.com)

## 按角色开始

### 内容编辑（不需要写代码）

使用 Pages CMS 新建或修改博客、工具落地页。保存后系统会提交到 GitHub，并由 Vercel 自动发布到生产环境。请先阅读 [Pages CMS 中文操作教程](docs/PAGES_CMS_GUIDE.md)，尤其不要修改已发布内容的 URL 路径。

### 开发者

需要 Node.js 22 和 npm。首次运行：

```sh
git clone https://github.com/teddy920810/ai-watermark-remover.git
cd ai-watermark-remover
npm ci
copy .env.example .env.local
npm run dev
```

环境变量中的 R2 密钥必须从项目管理员处通过安全渠道获取，不要从仓库、聊天截图或文档中复制真实密钥。详细说明见 [开发者指南](docs/DEVELOPER_GUIDE.md) 和 [贡献指南](CONTRIBUTING.md)。

### 运维人员

域名、Vercel、R2、Analytics、发布与回滚步骤见 [运维手册](docs/OPERATIONS_RUNBOOK.md)。

## 架构概览

```text
浏览器
  ├─ Astro 静态内容页面
  ├─ React Google 登录与上传组件
  └─ Better Auth 加密会话
       ├─ Vercel API：生成 R2 预签名上传地址
       ├─ 浏览器直传私有 R2
       └─ Vercel API：创建/查询处理任务
                         ├─ WatermarkProvider（去水印）
                         └─ BackgroundRemovalProvider（背景移除）

Pages CMS → GitHub main → Vercel 自动构建 → www.watermarkgemini.com
```

R2 Bucket 为 `watermark`，必须保持私有。`uploads/`、`results/`、`jobs/` 应配置 1 天自动过期。上传密钥只允许在服务端环境变量中使用。

Google OAuth 回调地址为 `/api/auth/callback/google`。本地 4321 端口与正式域名应分别在 Google Cloud 配置完整回调 URI。认证采用加密会话；Neon 保存 Google 授权提供的基础资料（稳定账号标识、邮箱及验证状态、姓名、头像、语言和 Workspace 域名，缺失的可选字段为空），以及免费余额、签到、扣减/退回账本和活跃时间。Google OAuth access token、refresh token 和 ID token 不写入资料表，供应商密钥和图片也不写入 Neon。账户历史列表和订阅仍属于后续版本。

Dewatermark、Neon 与可选 R2 本地凭据可以通过 `npm run processing:import -- <Dewatermark Key 文件> <Neon URL 文件> [S3-info 文件]` 导入到被 Git 忽略的 `.env.local`。`npm run processing:check` 只检查供应商余额和数据库只读连接，不处理图片或消耗图片 credit。首次部署权益功能前运行一次 `npm run db:migrate`；该命令使用版本化 SQL 和事务锁安全建表。本地默认保持 `WATERMARK_PROVIDER=mock` 和 `BACKGROUND_REMOVAL_PROVIDER=mock`；生产环境通过 Vercel 的服务端变量分别选择真实 Provider。Replicate token 只保存在服务端环境变量 `REPLICATE_API_TOKEN` 中。

## 目录说明

- `src/content/blog/`：博客 Markdown 内容
- `src/content/landing-pages/`：工具落地页 JSON 内容
- `src/content/homepage/home.json`：Pages CMS 管理的首页内容
- `src/content/legal/`：Pages CMS 管理的隐私政策和使用条款
- `src/content/settings/`：Pages CMS 管理的 Header、Footer、公告、博客列表、落地页公共模块和 404
- `public/uploads/`：Pages CMS 管理的静态图片资源
- `.pages.yml`：Pages CMS 字段和权限配置
- `src/pages/api/`：Vercel 服务端 API
- `src/lib/providers/`：可替换的图片处理 Provider
- `public/`：站点根路径静态资源；`/sitemap.xml` 会根据公开内容自动生成
- `docs/`：产品、开发和运维文档

## 质量检查

行为变更采用 TDD：先写失败测试，再实现。本地检查按改动范围选择：

```sh
npm run check:fast       # 普通小改
npm run check:content    # CMS、Blog、落地页、图片内容
npm run check:ui         # 布局、全局样式、公共 UI
npm run release:verify   # API、安全、构建链、依赖或其他高风险改动
```

PR 的 GitHub CI 始终运行完整 `npm run verify`，它是合并 `main` 的必需门禁。低风险改动无需在本地和 CI 重复执行同一套全量检查。首次在本机运行 E2E 前执行 `npx playwright install chromium`。生产环境真实链路使用 `npm run test:smoke:production`，该命令会向 R2 写入无敏感的 1×1 测试图片并由生命周期自动清理，不能在不知情的情况下反复运行。

测试分层、CI、失败处理和共创者操作说明见 [测试与质量指南](docs/TESTING_GUIDE.md)。不要提交 `.env.local`、R2 密钥、`S3-info.txt`、构建输出或本地测试截图。

## 文档索引

- [Pages CMS 中文操作教程](docs/PAGES_CMS_GUIDE.md)
- [开发者指南](docs/DEVELOPER_GUIDE.md)
- [运维手册](docs/OPERATIONS_RUNBOOK.md)
- [测试与质量指南](docs/TESTING_GUIDE.md)
- [贡献指南](CONTRIBUTING.md)
- [产品 PRD 与技术方案](docs/product/AI_Watermark_Remover_MVP_PRD_Technical_Solution.md)

