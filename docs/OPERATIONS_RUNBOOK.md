# 运维手册

## 生产资源

- 正式域名：`https://www.watermarkgemini.com`
- 备用 Vercel 域名：`https://ai-watermark-remover-peach.vercel.app`
- GitHub：`teddy920810/ai-watermark-remover`
- Cloudflare R2 Bucket：`watermark`
- Google Analytics：`G-52ZWCGEZ7R`

## Vercel 必要配置

Production 环境至少配置 `SITE_URL=https://www.watermarkgemini.com`、所有 `R2_*` 变量、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`BETTER_AUTH_SECRET` 和 `BETTER_AUTH_URL=https://www.watermarkgemini.com`。Preview/Development 如需上传或登录功能，也应单独配置对应变量。密钥变更后需要重新部署才能生效。

Google Cloud OAuth Web Client 必须包含正式回调 `https://www.watermarkgemini.com/api/auth/callback/google`。根域名 `https://watermarkgemini.com` 应使用 308 重定向到 `www`。OAuth 修改部署后必须使用真实测试用户完成一次登录、确认回调成功、会话建立、退出登录和处理任务；仅检查按钮或接口 200 不代表集成完成。

Git 页面应保持仓库连接到 `main`；域名页面应确保根域名为 Production，`www` 以 308 重定向到根域名。正常情况下 Vercel 自动管理 HTTPS 证书。

## Cloudflare R2

使用 `docs/r2-cors.example.json` 作为允许来源基线。CORS 只解决浏览器直传权限；遇到 `ERR_CONNECTION_CLOSED` 还应检查网络、R2 endpoint、预签名 URL 和 Bucket 凭据。

配置三个生命周期规则，让 `uploads/`、`results/`、`jobs/` 在 1 天后过期。定期确认规则没有被关闭，并轮换长期访问密钥。

## 发布检查

1. GitHub `main` 出现预期提交。
2. Vercel 最新 Production 部署为 **Ready**。
3. 打开首页、一个博客页和一个落地页。
4. 检查上传流程、`/robots.txt`、`/sitemap.xml`。
5. 在 GA Realtime 确认访问事件；新站点数据可能延迟。

部署后运行：

```sh
npm run test:smoke:production
```

该命令通过正式域名完成预签名、R2 PUT、创建任务、查询结果和下载验证。它不会输出签名 URL 或对象 Key，但会写入一个 1×1 PNG、结果对象和任务记录；这些对象依赖 R2 的 24 小时生命周期自动清理。Smoke 失败时不要连续重试，先检查 Vercel Environment Variables 的 Production 作用域、R2 CORS、凭据和 Function Logs。

## 常见故障

### Pages CMS 日期导致构建失败

Build Logs 出现 `publishedAt: Expected type string, received object` 时，先确认线上代码包含日期规范化逻辑，再检查 CMS 中日期字段是否通过日期控件保存。不要手工编辑成嵌套对象。

### Vercel 显示 Blocked

提交作者没有被 Vercel/GitHub 识别时可能阻止部署。确认 Pages CMS 使用 `identity: app`，并检查仓库集成和账号授权。必要时由已授权开发者产生一个新的正常提交。

### 上传失败

依次检查浏览器控制台、Vercel Function Logs、R2 CORS、环境变量作用域和凭据是否有效。不要把预签名 URL 或密钥粘贴到公开 issue。

## 回滚

内容错误优先在 Pages CMS 修正并重新发布。代码或配置故障可在 Vercel 将上一条 **Ready** 部署 Promote/Redeploy，随后在 GitHub revert 问题提交，保证代码历史与生产状态一致。禁止强制推送或删除失败部署记录。

## 定期维护

- 每月：检查依赖安全更新、Vercel/R2 用量、失败部署和 GA 是否持续收数。
- 每季度：测试恢复/回滚流程、检查 R2 生命周期和 CORS、审查仓库与平台成员权限。
- 人员离开时：立即撤销 GitHub/Vercel/Cloudflare 权限并轮换共享凭据。

