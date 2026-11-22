# 从当前项目复制新站

本仓库同时承担两个角色：`main` 保存并持续发布 WatermarkGemini；任何新站从整个仓库 fork 或使用 GitHub Template 创建自己的仓库。新站拥有独立内容、提交历史、Pages CMS、Vercel 项目、域名、OAuth 和存储，不与 WatermarkGemini 共用生产数据。

## 1. 创建新仓库

在 GitHub 使用 **Fork**；若仓库管理员已开启 **Template repository**，也可以使用 **Use this template**。不要在 WatermarkGemini 的 `main` 上直接替换品牌内容。新仓库创建后先建立自己的工作分支。

## 2. 准备站点身份配置

把 `template/site.config.example.json` 复制为根目录的 `site.config.json`，填写新站名称、正式 HTTPS 域名、Logo 路径、默认 SEO、GA4 ID 和博客默认信息。该文件不能包含 OAuth、R2 或其他密钥。

先只预览：

```text
npm run site:init -- site.config.json
```

确认输出仅包含 `package.json`、`.env.example` 和 `src/content/settings/site.json` 后，再明确应用：

```text
npm run site:init -- site.config.json --apply
```

应用前的三个文件会复制到被 Git 忽略的 `.site-init-backup/`。初始化器不会删除或覆盖博客、法律页、落地页、首页正文、Header 或 Footer，因此当前示例内容仍可作为参考。

## 3. 用 Pages CMS 建立自己的内容

为新仓库授权 Pages CMS，然后按以下顺序修改：

1. 上传新 Logo、Favicon 和分享图片，并确认 `site.config.json` 中的路径存在。
2. 在“站点设置”修改 Header、Footer、公告和结构化数据。
3. 重写首页、博客列表、各工具落地页、法律页和 404。
4. 删除或改成草稿的旧博客；删除不需要的工具落地页。
5. 在“图片信息”登记复用图片的 Alt、标题和尺寸。
6. 检查自动生成的 `/sitemap.xml` 不再包含旧内容 URL。

Pages CMS 的详细字段说明见 `docs/PAGES_CMS_GUIDE.md`。

## 4. 建立独立的外部资源

新站必须单独配置：

- 独立的 Vercel Site 和 App 项目。两边设置新站 `SITE_URL`，App 设置 `BETTER_AUTH_URL` 与指向新 Site 的 `APP_SITE_ORIGIN`。构建和路由见[独立部署说明](../apps/DEPLOYMENT_TARGETS.md)；
- Google OAuth Client 与新域名回调；
- GA4 Measurement ID（暂不使用时在站点设置留空）。当前公开布局包含 WatermarkGemini 的 AdSense 发布商接入，初始化器不会替换它，新站上线前需按自身账号审核或移除这段接入；
- Cloudflare R2 Bucket、生命周期、CORS 和最小权限密钥；
- GitHub Pages CMS App 权限与分支保护。

模板初始化只处理站点身份。处理开关默认关闭，本地示例使用 Mock Provider 配置。需要云端处理时，另建数据库、私有媒体存储和独立 Worker，按[处理配置](product/PROCESSING_CONFIGURATION.md)完成调度、密钥和真实验收后再开放。

## 5. 上线前验收

先执行 `npm run site:validate`，处理域名、图片和路由等检查的错误及警告。首次完整上线按[验证矩阵](TESTING_GUIDE.md#动态验证矩阵)运行本地发布检查，再独立确认 GitHub 必需门禁、受影响目标与生产验收。检查规范域名及其 308 重定向，并核对最终的 Canonical、robots.txt 和 sitemap.xml。

## WatermarkGemini 是否会被保留

会。模板初始化器只在运行它的仓库中生效；fork 后的改动不会反向修改本仓库。WatermarkGemini 的内容仍留在本仓库 `main`，可以继续独立更新和部署。
