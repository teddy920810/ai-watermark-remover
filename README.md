# ClearMark AI / Watermark Gemini

ClearMark AI 是部署在 [watermarkgemini.com](https://watermarkgemini.com) 的图片水印处理 MVP。项目采用 Astro、React、Vercel 与私有 Cloudflare R2，并通过 Pages CMS 让非技术成员直接维护博客和 SEO 落地页。

> 当前状态：匿名用户可以选择和预览图片，创建处理任务时需要通过 Google 登录。上传、临时存储和任务流程已经可用，但处理器仍是 Mock Provider。它会复制原图作为结果，不代表已经真正移除水印。接入正式图像处理服务前，不应对外宣称具备真实去水印效果。

## 常用入口

- 正式站点：[watermarkgemini.com](https://watermarkgemini.com)
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
                         └─ WatermarkProvider（当前为 Mock）

Pages CMS → GitHub main → Vercel 自动构建 → watermarkgemini.com
```

R2 Bucket 为 `watermark`，必须保持私有。`uploads/`、`results/`、`jobs/` 应配置 1 天自动过期。上传密钥只允许在服务端环境变量中使用。

Google OAuth 回调地址为 `/api/auth/callback/google`。本地 3000 端口与正式域名应分别在 Google Cloud 配置完整回调 URI。当前认证采用无数据库加密会话，任务记录会保存会话用户 ID；账户历史列表、额度和订阅仍属于后续 V2 工作。

## 目录说明

- `src/content/blog/`：博客 Markdown 内容
- `src/content/landing-pages/`：工具落地页 JSON 内容
- `src/content/homepage/home.json`：Pages CMS 管理的首页内容
- `public/uploads/`：Pages CMS 管理的静态图片资源
- `.pages.yml`：Pages CMS 字段和权限配置
- `src/pages/api/`：Vercel 服务端 API
- `src/lib/providers/`：可替换的图片处理 Provider
- `public/`：站点根路径静态资源，例如 `/sitemap.xml`
- `docs/`：产品、开发和运维文档

## 质量检查

行为变更采用 TDD：先写失败测试，再实现。提交前运行：

```sh
npm run verify
```

它会依次执行覆盖率测试、代码检查、生产构建和 Chromium E2E。首次在本机运行 E2E 前执行 `npx playwright install chromium`。生产环境真实链路使用 `npm run test:smoke:production`，该命令会向 R2 写入无敏感的 1×1 测试图片并由生命周期自动清理，不能在不知情的情况下反复运行。

测试分层、CI、失败处理和共创者操作说明见 [测试与质量指南](docs/TESTING_GUIDE.md)。不要提交 `.env.local`、R2 密钥、`S3-info.txt`、构建输出或本地测试截图。

## 文档索引

- [Pages CMS 中文操作教程](docs/PAGES_CMS_GUIDE.md)
- [开发者指南](docs/DEVELOPER_GUIDE.md)
- [运维手册](docs/OPERATIONS_RUNBOOK.md)
- [测试与质量指南](docs/TESTING_GUIDE.md)
- [贡献指南](CONTRIBUTING.md)
- [产品 PRD 与技术方案](docs/product/AI_Watermark_Remover_MVP_PRD_Technical_Solution.md)
