# 运维手册

## 生产资源

- 正式域名：`https://www.watermarkgemini.com`
- GitHub：`teddy920810/ai-watermark-remover`
- Cloudflare R2 Bucket：`watermark`
- Google Analytics：`G-52ZWCGEZ7R`

## Vercel 必要配置

Site 和 App 是独立的 Vercel 目标。两者都以 `SITE_URL=https://www.watermarkgemini.com` 为规范站点地址；App 通过 `APP_SITE_ORIGIN` 将公开页面代理到 Site。App 的服务端环境负责 `BETTER_AUTH_URL`、`BETTER_AUTH_SECRET`、Google OAuth、数据库和私有 R2，Site 无需这些密钥。预览与开发环境按各自的目标和连接配置。发布项目、代理边界与构建命令见[独立部署说明](../apps/DEPLOYMENT_TARGETS.md)。

真实图片去水印走耐久处理链，由 `PROCESSING_ENABLED=true`、`PROCESSING_PROVIDER=dewatermark` 和服务端 `DEWATERMARK_API_KEY` 启用。按[处理配置](product/PROCESSING_CONFIGURATION.md)设置 App 调度和独立 Worker；背景、物体、视频各有自己的 Provider 配置。正式 PayPal 收款的启动校验另外读取 `WATERMARK_PROVIDER=dewatermark`，见[PayPal 发布手册](PAYPAL_LIVE_RELEASE.md)。密钥不要使用 `PUBLIC_` 前缀，变更后重新部署受影响目标。

Google Cloud OAuth Web Client 必须包含正式回调 `https://www.watermarkgemini.com/api/auth/callback/google`。OAuth 变更后，用真实测试用户核对回调、会话建立和退出。涉及媒体处理时按[验证矩阵](TESTING_GUIDE.md#动态验证矩阵)另选操作和授权预算。

Git 页面应保持仓库连接到 `main`；域名页面以 `www.watermarkgemini.com` 为正式站点，根域名以 308 重定向到 `www`。正常情况下 Vercel 自动管理 HTTPS 证书。代码、CI、部署绑定与线上验收分开结清，Ready不代表已通过真实功能验收。

## AdSense 网站连接

公共页面的 `src/layouts/SiteLayout.astro` 在 `<head>` 加载用户提供的异步 AdSense 脚本和 `google-adsense-account` 验证标签。站点根路径 `/ads.txt` 由 Site 从 `public/ads.txt` 发布，使用后台提供的授权记录。脚本、标签和授权记录使用同一个发布商 ID `5361898162179630`。私有 App 工作区和 OAuth 弹窗沿用独立布局。更换发布商时，先核对账号与站点归属，再同步三处记录和专项测试。[Google 官方接入说明](https://support.google.com/adsense/answer/7584263)

发布后核对首页、工具落地页和 Blog 的 `<head>` 各有一个正确的脚本和验证标签，并在真实浏览器确认脚本请求及执行。从根域名和 `www` 分别用 HTTP 和 HTTPS 请求 `/ads.txt`，确认最终返回 `200`、`text/plain` 和后台授权记录。[Google ads.txt 抓取说明](https://support.google.com/adsense/answer/7679060)

在对应 AdSense 账号确认网站审核状态和 `ads.txt` 是否已授权。实际展示广告前，由内容负责人审核广告相关隐私披露，并完成适用地区的同意管理配置。

## Cloudflare R2

使用 `docs/r2-cors.example.json` 作为允许来源基线。`PUT` 用于浏览器直传，`GET`/`HEAD` 用于读取透明结果并在浏览器合成彩色 PNG；缺少 `GET` 时预览仍可能显示，但 Canvas 下载会被 CORS 拦截。遇到 `ERR_CONNECTION_CLOSED` 还应检查网络、R2 endpoint、预签名 URL 和 Bucket 凭据。

测试额度只能通过后台命令补充，不提供公共管理接口。先运行 `npm run db:migrate`，再使用 `npm run benefits:grant-test -- --email "测试账号邮箱" --uses 3 --reference "qa-YYYYMMDD-purpose"` 预览变更；确认无误后在同一命令末尾增加 `--apply`。每次补充受 3 次上限约束，使用独立 `test_grant` 账本原因和幂等 reference，重复执行同一 reference 不会重复发放。不要把邮箱、数据库连接或命令输出粘贴到公开 issue。

旧链`uploads/`、`results/`、`jobs/`按一天过期。新链只对`processing/staging/`、`processing/inputs/`、`processing/masks/`、`processing/results/`四个独立媒体前缀设置一天Expiration，不能对整个`processing/`设置TTL；jobs、quotes、attempts等恢复控制记录继续保留。实际配置回读与后台删除时间边界见[Worker生命周期规范](product/WORKER_DEPLOYMENT.md#媒体过期与控制记录)。

## 发布检查

确认预期提交已进入 `main`，受影响目标的 Production 部署为 **Ready** 且绑定预期 SHA。检查内容、页面和真实功能的范围统一按[验证矩阵](TESTING_GUIDE.md#动态验证矩阵)与[抽查标准](TESTING_GUIDE.md#抽查标准)执行，本页不另设全站检查清单。

命令、单位、预算及失败恢复要求见[运维验收](TESTING_GUIDE.md#运维人员)。GA 改动核对真实 `page_view`/Realtime 信号，普通内容或样式发布不重复验证 GA、登录或收费处理。

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

