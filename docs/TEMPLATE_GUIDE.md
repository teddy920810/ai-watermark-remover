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
3. 重写首页、博客列表、落地页公共模块、法律页和 404。
4. 删除或改成草稿的旧博客；删除不需要的工具落地页。
5. 在“图片信息”登记复用图片的 Alt、标题和尺寸。
6. 检查自动生成的 `/sitemap.xml` 不再包含旧内容 URL。

Pages CMS 的详细字段说明见 `docs/PAGES_CMS_GUIDE.md`。

## 4. 建立独立的外部资源

新站必须单独配置：

- Vercel 项目和 `SITE_URL`、`BETTER_AUTH_URL`；
- Google OAuth Client 与新域名回调；
- GA4 Measurement ID（暂不使用时在站点设置留空）；
- Cloudflare R2 Bucket、生命周期、CORS 和最小权限密钥；
- GitHub Pages CMS App 权限与分支保护。

真实图片处理 Provider 不在当前模板初始化范围内；接入前仍会使用 Mock Provider，不能对外宣称已真实移除水印。

## 5. 上线前验收

先执行 `npm run site:validate`，它会检查域名一致性、缺失图片、GitHub blob 图片地址、无效站内链接、重复 URL 和保留路由冲突。再执行 `npm run verify`，确认 GitHub CI 通过；浏览器验收会覆盖 sitemap 中的全部公开页面和 404。随后检查桌面端和移动端、登录回调、上传流程、法律内容、Canonical、robots.txt、sitemap.xml 和 GA 收数，最后把根域名 308 重定向到选定的唯一规范域名。

## WatermarkGemini 是否会被保留

会。模板初始化器只在运行它的仓库中生效；fork 后的改动不会反向修改本仓库。WatermarkGemini 的内容仍留在本仓库 `main`，可以继续独立更新和部署。
