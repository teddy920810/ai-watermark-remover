# 2026-11-14 新增五个运营工具页

按用户提供的五份运营 Word 及明确上线授权，新增 `remove-emoji-from-photo`、`remove-person-from-photo`、`remove-logo-from-video`、`remove-text-from-video` 和 `remove-object-from-video`。文案取自 `SEO Research & Keyword Mapping` 标题之前，研究附录不发布；正文、SEO、FAQ、卡片、按钮、图片 alt 和示意图说明保留原文。原始 Word、逐字段核对与素材证据保留本机，不进入仓库。

每页复用现有 Astro 工具页模板：三组首屏独立 Before/After、三步说明、四张功能图、八张工具卡、六个指南、十一条 FAQ 和底部 CTA。按 Image brief 生成的五十张 WebP 放在 `public/uploads/landing-new-20261114/`；它们是示意素材，不是实际产品处理证据。步骤区复用本页相关场景。Date Stamp / Signature 两张卡按原稿要求沿用现有模板链接。

两个照片页通过现有 `object-remover` 推荐照片物体移除；三个视频页通过 `video-watermark-remover` 推荐视频可见标记清理。没有新增操作、Provider 请求、跟踪能力、鉴权、价格或额度行为。

新增可选内容字段 `uploadButtonLabel`，由 Pages CMS 编辑并传给现有公共文件入口，显示运营提供的逐页上传文案。未填写时保留 Upload file，既有 `uploader` 字段和其他页面不变。底部按钮继续使用现有逐页 CTA。此字段只改变空闲按钮文字，不改变媒体识别、选文件、工作区交接、登录、上传或确认处理状态。

原稿要求使用本页场景作为 Open Graph 分享图，因此通过可选 `shareImage` 将每页第一张首屏图传给现有 SiteLayout；未填写的旧页面继续使用站点默认分享图。没有改动第三方脚本或站点默认元信息。

`shareImage` 同步纳入内容 API 的公共图片路径校验和素材引用收集，拒绝无效／外部地址，并在发布校验中拦截缺失素材；图片审计也记录此字段。相关回归覆盖非法 URL、缺失素材和补齐素材后的可发布状态。

发布核对包括五页原文、五十张素材哈希、最终 HTML / FAQ / canonical / sitemap，及照片与视频入口的本地文件交接；执行与最终风险范围匹配的发布门禁。上线后只读核对全部新增页面与素材，并在桌面、手机抽查模板及既有页面。处理操作本身未改变，本次内容发布不作为 OAuth、Provider 或扣费功能验收。
