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

提交应聚焦单一目标，说明用户可见影响。不要绕过类型检查、测试或安全约束。改动内容模型时必须同步更新 `src/content.config.ts`、`.pages.yml` 和 Pages CMS 教程。

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
