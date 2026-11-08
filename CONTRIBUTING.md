# 共创与提交指南

## 开始前

1. 从 `main` 拉取最新代码：`git pull --ff-only origin main`。
2. 开发者建议从最新 `main` 创建功能分支；内容编辑可以直接使用 Pages CMS。
3. 不要提交 `.env.local`、访问密钥、`S3-info.txt` 或用户上传图片。
4. Git 提交邮箱应关联你的 GitHub/Vercel 账号，否则 Vercel 可能阻止部署。

Pages CMS 内容通过审核分支、受保护 PR 与必需 CI 进入 `main`。因此长时间开发期间，应在提交前再次执行 `git fetch origin main`，发现远端更新后先 rebase 或合并，禁止强制推送覆盖内容编辑的提交。

## 开发流程

涉及行为或配置约束的改动先运行定向红测，再做最小实现并运行绿测。本地检查、CI 必需门禁、生产抽查与收费验收统一按[测试指南](docs/TESTING_GUIDE.md#动态验证矩阵)执行；首次运行浏览器测试前执行 `npx playwright install chromium`。

提交应聚焦单一目标，说明用户可见影响。不要绕过类型检查、测试或安全约束。改动内容模型时必须同步更新 `src/content.config.ts`、`.pages.yml` 和 Pages CMS 教程。

## 第三方集成代码规则

GA、支付、登录、Cloud SDK、Consent 的初始化片段按[项目第三方集成合同](AGENTS.md#third-party-integration-contract-rules)逐字保留；需要偏离时先核对官方依据并取得批准。该合同统一维护回归测试、真实端到端信号和未验证状态要求。

## 内容与代码的边界

- 文案、博客、FAQ、SEO 标题：优先通过 Pages CMS 修改。
- 页面结构、样式、API、字段模型：由开发者修改代码并走测试流程。
- 已发布 `slug` 不应修改；确需变更时由开发者同时配置重定向。
- CMS现有collection允许删除；删除公开内容前由内容负责人和开发者核对引用、旧URL和必要重定向，再走适用发布门禁。CMS允许删除不等于没有断链风险。

## 提交前检查

- 工作区不存在密钥和临时文件。
- 按[验证矩阵](docs/TESTING_GUIDE.md#动态验证矩阵)完成适用检查；目标页面和 SEO 文件仅在受影响时验收。
- 已同步远端 `main`，没有覆盖 Pages CMS 新提交。
- 第三方集成有改动时，核对官方原始片段和平台侧真实事件，或明确记录未验证项。
