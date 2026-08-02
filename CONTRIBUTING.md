# 共创与提交指南

## 开始前

1. 从 `main` 拉取最新代码：`git pull --ff-only origin main`。
2. 开发者建议从最新 `main` 创建功能分支；内容编辑可以直接使用 Pages CMS。
3. 不要提交 `.env.local`、访问密钥、`S3-info.txt` 或用户上传图片。
4. Git 提交邮箱应关联你的 GitHub/Vercel 账号，否则 Vercel 可能阻止部署。

Pages CMS 会直接向 `main` 写入内容提交。因此长时间开发期间，应在提交前再次执行 `git fetch origin main`，发现远端更新后先 rebase 或合并，禁止强制推送覆盖内容编辑的提交。

## 开发流程

涉及行为或配置约束的改动遵循 TDD：

1. 添加或更新测试，并确认测试因目标行为尚未实现而失败。
2. 实现最小改动使测试通过。
3. 重构并运行全量检查。

```sh
npm run verify
```

`verify` 包含覆盖率、Lint、生产构建和浏览器 E2E。首次运行浏览器测试前执行 `npx playwright install chromium`。只改文案也必须至少运行 `npm run verify`，因为内容 schema、SEO 路由和 Pages CMS 数据可能导致构建失败。

测试职责：

- 纯函数和服务规则：Vitest 单元测试。
- API、环境变量和安全错误：Vitest 集成测试。
- 上传 UI、GA `page_view`、SEO 和无障碍：Playwright E2E。
- 正式域名与真实 R2：`npm run test:smoke:production`，仅在运维检查或部署后运行。

完整说明见 `docs/TESTING_GUIDE.md`。

提交应聚焦单一目标，说明用户可见影响。不要绕过类型检查、测试或安全约束。改动内容模型时必须同步更新 `src/content.config.ts`、`.pages.yml` 和 Pages CMS 教程。

## 第三方集成代码规则

GA、支付、登录、Cloud SDK、Consent 等第三方初始化片段属于“集成协议”，不是普通业务代码：

- 用户提供或厂商官方提供的代码默认逐字保留，只替换官方标明的 ID、域名等占位符。
- 不得擅自将其改写成看似等价的现代语法，不调整调用顺序、脚本属性、参数对象或加载时机。
- 确需偏离官方片段时，必须先查阅最新官方文档，向需求方说明差异和风险并取得确认。
- 修改前增加针对关键语义的失败测试；不能只测试“脚本存在”或“ID 正确”。
- 部署后验证真实业务信号。例如 GA 必须确认 `page_view` 网络事件或 Realtime/DebugView，而不只是确认 `gtag.js` 返回 200。
- 无法完成平台侧验证时，必须明确标注尚未验证的环节，不得宣称集成已经完整可用。

## 内容与代码的边界

- 文案、博客、FAQ、SEO 标题：优先通过 Pages CMS 修改。
- 页面结构、样式、API、字段模型：由开发者修改代码并走测试流程。
- 已发布 `slug` 不应修改；确需变更时由开发者同时配置重定向。
- 删除内容应由开发者在 Git 中完成，避免误删及断链。

## 提交前检查

- 工作区不存在密钥和临时文件。
- `npm run verify` 全部通过。
- 本地检查目标页面及 `/404`、`/robots.txt`、`/sitemap.xml`。
- 已同步远端 `main`，没有覆盖 Pages CMS 新提交。
- 第三方集成使用官方原始片段，并已验证平台侧真实事件或明确记录未验证项。
