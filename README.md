# ClearMark AI / Watermark Gemini

ClearMark AI 是部署在 [www.watermarkgemini.com](https://www.watermarkgemini.com) 的图片水印处理 MVP。项目采用 Astro、React、Vercel 与私有 Cloudflare R2，并通过 Pages CMS 让非技术成员直接维护博客和 SEO 落地页。

本仓库也可作为同类站点框架完整 fork：WatermarkGemini 内容继续保留在当前仓库，新站在自己的仓库中初始化品牌并通过 Pages CMS 重建内容。操作见 [新站模板指南](docs/TEMPLATE_GUIDE.md)。

> 当前状态：匿名用户可以选择和预览图片，创建处理任务时需要通过 Google 登录。首次登录获得 1 次免费处理，每日签到增加 1 次，免费余额上限为 3 次；去水印、背景移除和物体移除共用这份余额。上传、临时存储和任务流程已经可用；生产环境可分别通过服务端配置启用 Dewatermark v3 去水印 Provider、Replicate 851 Labs 背景移除 Provider 和 Replicate LaMa 物体移除 Provider，本地和测试环境默认仍使用 Mock Provider。

新图片工作区提供普通、PRO 和画笔精修；视频工作区支持 MP4、24 fps、最长 9 分钟、100 MB，以及整段生效的固定选区。普通图片保留免费次数规则，PRO、精修和视频使用管理员分配的处理额度。选择文件即时预览，登录后自动上传检查、计算费用；点击带完整费用的处理按钮才开始，无需重复检查或确认弹窗。新环境的处理链路配置默认关闭，须配置完整耐久执行服务后启用；这一默认值不表示生产关闭，生产验收见发布记录。

SEO 静态站、App/API 和容器 Worker 使用独立构建与发布目标。重构阶段与原始验收见 [重构台账](docs/product/REFACTOR_LEDGER.md)，2026-11-01 的后续交付与剩余观察见 [发布记录](docs/product/RELEASE_READINESS.md)；历史设计依据见 [产品与初始状态设计](docs/product/PROCESSING_PRODUCT_DESIGN.md) 和 [架构方案](docs/product/PROCESSING_ARCHITECTURE.md)，现行配置与部署合同见 [配置说明](docs/product/PROCESSING_CONFIGURATION.md) 和 [Worker 部署](docs/product/WORKER_DEPLOYMENT.md)。账户与管理员额度操作见 [身份说明](docs/ACCOUNT_IDENTITY.md) 和 [额度说明](docs/PROCESSING_CREDITS.md)。

## 常用入口

当前规范、设计依据和历史验收统一从[文档总索引](docs/INDEX.md)进入；操作与路由所有者见[当前架构](docs/CURRENT_ARCHITECTURE.md)。原实施台账和初始PRD不作为全项目实时状态。

- 正式站点：[www.watermarkgemini.com](https://www.watermarkgemini.com)
- GitHub：[teddy920810/ai-watermark-remover](https://github.com/teddy920810/ai-watermark-remover)
- 内容后台：[Pages CMS](https://app.pagescms.org)
- 部署平台：[Vercel](https://vercel.com)

## 按角色开始

### 内容编辑（不需要写代码）

使用 Pages CMS 在内容审核分支新建或修改博客、工具落地页；通过PR审核和必需CI后合并main，再由Vercel发布。模板入口创建草稿分支与PR，不直接写main。请先阅读 [Pages CMS 中文操作教程](docs/PAGES_CMS_GUIDE.md)，尤其不要修改已发布内容的 URL 路径。

### 开发者

使用受支持且已修复安全问题的 Node.js 22/24 与 npm；Worker 使用 Node.js 24，当前镜像固定为 24.22.1。首次运行：

```sh
git clone https://github.com/teddy920810/ai-watermark-remover.git
cd ai-watermark-remover
npm ci
node -e "require('node:fs').copyFileSync('.env.example','.env.local',require('node:fs').constants.COPYFILE_EXCL)"
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
                         ├─ BackgroundRemovalProvider（背景移除）
                         └─ ObjectRemovalProvider（物体移除）

Pages CMS 内容分支 → PR / 必需CI / 内容审核 → GitHub main → Vercel → www.watermarkgemini.com
```

R2 Bucket为`watermark`，必须保持私有。旧`uploads/results/jobs`按一天过期；新链仅媒体四个精确前缀过期，恢复控制记录保留。生命周期权威说明见[Worker部署](docs/product/WORKER_DEPLOYMENT.md#媒体过期与控制记录)。上传密钥只允许在服务端使用。

Google OAuth回调地址为`/api/auth/callback/google`。本地与正式域名分别配置完整URI。Neon保存基础资料、稳定身份、三类权益和金融/outbox记录，不保存Google OAuth token、图片或Provider密钥。App已有有效期内的Recent work任务历史与恢复；永久媒体历史和订阅尚未提供。详见[身份规范](docs/ACCOUNT_IDENTITY.md)和[当前架构](docs/CURRENT_ARCHITECTURE.md)。

Dewatermark、Neon 与可选 R2 本地凭据可以通过 `npm run processing:import -- <Dewatermark Key 文件> <Neon URL 文件> [S3-info 文件]` 导入到被 Git 忽略的 `.env.local`。`npm run processing:check` 只检查供应商余额和数据库只读连接，不处理图片或消耗图片 credit。首次部署权益功能前运行一次 `npm run db:migrate`；该命令使用版本化 SQL 和事务锁安全建表。本地默认保持 `WATERMARK_PROVIDER=mock`；配置 `REPLICATE_API_TOKEN` 后，背景移除和物体移除会自动选择 Replicate，也可分别用 `BACKGROUND_REMOVAL_PROVIDER=mock` 和 `OBJECT_REMOVAL_PROVIDER=mock` 显式覆盖。Replicate token 只保存在服务端环境变量中。

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

PR 的 GitHub CI 始终运行完整 `npm run verify`，它是合并 `main` 的必需门禁。低风险改动无需在本地和 CI 重复执行同一套全量检查。首次在本机运行 E2E 前执行 `npx playwright install chromium`。`npm run test:smoke:production` 只检查公开入口和匿名保护，不上传文件或调用 Provider。真实处理验收使用对应的认证功能命令，会写入临时资源并消耗额度，必须按已确认的预算运行一次；命令选择见 [测试与质量指南](docs/TESTING_GUIDE.md)。

测试分层、CI、失败处理和共创者操作说明见 [测试与质量指南](docs/TESTING_GUIDE.md)。不要提交 `.env.local`、R2 密钥、`S3-info.txt`、构建输出或本地测试截图。

## 文档索引

- [PayPal 图片 Credits 与正式发布](docs/PAYPAL_LIVE_RELEASE.md)：一次性购买，三种图片工具分别计费；与免费次数、管理员处理额度分开，默认关闭收款。

- [Pages CMS 中文操作教程](docs/PAGES_CMS_GUIDE.md)
- [SEO 运营 Agent 内容 API](docs/CONTENT_API.md)：内容域 Token、持久草稿/素材、精确差异审核和受保护发布。
- [开发者指南](docs/DEVELOPER_GUIDE.md)
- [运维手册](docs/OPERATIONS_RUNBOOK.md)
- [测试与质量指南](docs/TESTING_GUIDE.md)
- [贡献指南](CONTRIBUTING.md)
- [初始MVP需求历史快照](docs/history/AI_Watermark_Remover_MVP_PRD_Technical_Solution.md)（不作为当前协议）

