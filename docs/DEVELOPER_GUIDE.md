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

## R2 约束

- Bucket：`watermark`，保持私有。
- 客户端只接收短期预签名 URL，不得获得 R2 密钥。
- CORS 只允许明确的生产/预览/本地来源及必要方法。
- `uploads/`、`results/`、`jobs/` 配置 1 天生命周期删除规则。
- 日志不得输出签名 URL、密钥或完整用户图片内容。

## 测试与发布

```sh
npm test
npm run lint
npm run build
# 或一次执行全部：
npm run verify
```

Pages CMS 可能随时提交到 `main`。推送前执行 `git fetch origin main` 并检查分歧；如远端领先，先安全 rebase/merge，禁止 force push。合并到 `main` 后 Vercel 自动发布。

