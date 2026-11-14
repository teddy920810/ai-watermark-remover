# TikTok 链接工具

入口 `/app/free/tiktok`；`POST /api/tools/tiktok/resolve` 接受 `{ operation: "tiktok-video-resolve", url }`。操作限制统一来自 `resolverOperationCatalog`。本地接口核对回环主机；生产要求 HTTPS、同源 Origin 和数据库准入。没有 SEO 正文、图片或导航内容修改，没有 CMS 迁移。

## 功能合同

- 输入：HTTPS `www.tiktok.com/@user/video/ID` 完整链接，移除查询与锚点；短链接、图集、直播与其他平台不支持。
- 状态：初始 → 解析中 → 成功/失败；更改输入或点击输入框尾部清除按钮立即取消当前请求，清理旧结果并聚焦输入；组件卸载取消请求。超时可主动重试，没有自动重试或备用 Provider。
- 结果：静态读取 Tikmate 响应字面量，只返回允许的封面、标题和去重后的资源 URL。没有上游脚本执行。仅按返回资源数量显示下载入口，不虚构 HD、分辨率或多档画质。
- 产物：浏览器直接从第三方中转 `d.rapidcdn.app` 获取 MP4；本站不代理字节、不转码、不写 R2/数据库。预览失败不移除下载入口；链接失效由用户再次解析。点击下载不等于保存成功。
- 额度：匿名、零 Credits；无登录、报价、扣款、退款或付费交接；不修改既有 Gemini 或六类耐久处理操作。
- 安全：固定 Provider 请求目标、禁止重定向、整体 20 秒超时、按实际字节限制 1 MiB 响应/2 KiB 输入；no-store 与 no-referrer；不打印 Cookie、token、输入链接、签名资源 URL 或上游错误。工作区 CSP 仅允许指定视频域名和 TikTok 封面域名；不放宽其他工具策略。
- 生产准入：复用现有 PostgreSQL 连接池和迁移机制，`012_tiktok_admission.sql` 仅创建一张单行控制表，不存链接、IP、用户或媒体。原子争抢全局 25 秒租约、最短 2 秒请求间隔、每天 UTC 最多 500 次解析（失败也计数）；正常完成释放租约，进程中断后到期恢复，旧请求不能释放新租约。数据库缺失/失败返回 503，忙或达到上限返回 429；不降级到单进程限制。此处必要持久状态用于约束 Vercel 多实例，未新增服务或收费 API。

## 视觉与验收

界面沿用当前项目设计系统，参考图仅用于输入、预览和下载的交互关系。复用共享 design-system 的品牌、字体、蓝色按钮、柔和边框和现有工作区层级；提供品牌导航与返回工作区入口，采用链接输入和预览/下载双栏、窄屏单列。保持键盘焦点、状态提示和错误恢复。预览使用真实返回的视频与封面，不生成替代媒体。

正常进入路径：现有导航的 TikTok 工具链接 → `/tiktok-watermark-remover` 的 hero/页尾入口 → 链接工作区；App 工作区现有菜单也提供 TikTok 入口。显式链接入口登记在 `route-policy.mjs`，与文件 handoff 分开；其他工具保持原文件入口。生产与本地使用相同入口。原 TikTok SEO 正文、图片和导航配置保持原值，链接入口明确区分当前 URL 保存与历史文案描述的文件编辑。

工作区标题为 `TikTok Watermark Remover for Saved Videos`，提交按钮为 `Save Video`；移除 `New video`，尾部 X 按钮可键盘操作，并清理旧预览、错误和仍在进行的请求。

单元测试覆盖 URL 约束、纯数据解包、上游失败/超限、接口环境/来源与错误脱敏；操作级浏览器测试覆盖输入、结果、真实 MP4 夹具下载、复位、失败重试与窄屏。API/Provider/依赖改动按唯一测试矩阵运行 `release:verify`。真实授权单样本本地验收与 mock 回归分别记录，定时/CI 不调用真实 Provider。

2026-11-14 用户明确确认已取得用于本站公开接入的 Tikmate 授权，并授权提交上线。公开条款本身不视为接入授权；本记录不扩大到其他 Provider、用途或站点。发布前运行数据库迁移、`release:verify` 和两个必需 CI；发布后核对 Site/App 精确部署和现有授权单样本的真实解析、预览、下载与清除，点击下载不等于文件完整性验收。发布状态以实际交付记录为准。多样本稳定性、短链接、URL 有效期、跨网络、真实 Safari/手机兼容性后补；不据单样本扩大兼容承诺。没有依赖 R2、OAuth 的新操作，不将这些无关门禁计为通过。

参考协议：<https://tikmate.io/>、<https://tikmate.io/pages/terms-of-service.php>；MIT 参考仓库许可不替代上游服务接入许可。Acorn 仅解析语法：<https://github.com/acornjs/acorn/tree/master/acorn#interface>。
