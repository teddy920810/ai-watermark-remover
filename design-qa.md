# 首页设计包校准记录

final result: passed

## 核对范围

- 设计源：`E:/xwechat_files/sy236577346_7b05/msg/file/2026-10/watermarkgemini-home-layout-blueprint-release.zip`。
- 设计包浏览器参考：`http://127.0.0.1:4383/`（本轮临时预览）。
- 本地实现：`http://127.0.0.1:4382/`。
- 使用同一内置浏览器，在 1920×1080、768×1024、390×844 CSS 视口核对；截图密度 1。
- 完整桌面图片宽 1920 像素，完整手机图片宽 390 像素；纵向长度随真实内容变化。
- 默认状态为 Serum 样例、Logo 场景、滑块 50%、FAQ 收起。动态评价按卡片尺寸、间距、方向与暂停行为核对，不要求动画帧完全相同。
- 分模块对照图将设计放在左侧、实现放在右侧，按各模块起点对齐，排除受保护 header 高度和累计页长差异；测量记录保留原始 CSS 尺寸与滚动条占位。

## 发现、修正及复核

| 优先级 | 原问题 | 本次修正 | 复核证据 |
|---|---|---|---|
| P1 | 手机 Results 被内部网格最小宽度撑宽，图片及 CTA 裁到屏幕外 | 改为受约束的弹性布局，重置旧工具页外边距及最小宽度 | 手机实际对比框宽 350px，右缘 370px；五个场景循环均在 390px 视口内 |
| P1 | 手机工具卡片继承固定内部宽度 | 工具容器增加 100% 上限，恢复单列完整卡片 | 工具卡片宽度回归测试、手机全页截图 |
| P2 | 桌面标签栏 1100px，Feature 列宽与图片高度不匹配 | 标签栏 1200px；Feature 为 540×438px，移除旧图片 410px 高度上限 | 桌面几何测试与分模块对照图 |
| P2 | 首屏、步骤、标题、受众区和下半页的间距累积错位 | 恢复设计字号、行高、标题宽度、步骤图高、卡片网格及模块留白；收敛与设计不符的额外简介/标题按钮 | 桌面 Hero 868px、步骤区 622px、Features 2357px、受众区 726px、工具区 1019px、隐私区 598px、FAQ 943px，与设计包测量一致 |
| P2 | 首屏示意说明继承段落外边距，侵入信任标签及手机上传区 | 收紧该说明的作用域和外边距 | 桌面/手机“不重叠”红绿检查通过；最终截图说明与上传区之间留有 8px 间隔 |
| P2 | 手机偶数 Feature 的图片顺序不同 | 恢复先图后文，与设计包一致 | 几何测试、手机截图 |
| P2 | 切换样例/场景重置滑块；窄屏当前标签不可见 | 保留比较位置；自动将当前标签滚入可见区域；保留键盘操作 | 定向红测、绿测及内置浏览器手动检查 |
| P2 | 新增日期、签名、笔记本示意叠层使用通用水印 | 使用设计包相应样式，笔记本叠层仅覆盖屏幕；CMS 增加可编辑样式选择 | CMS 红绿测试、笔记本配对截图 |

## 截图与原始测量

目录：`output/playwright/calibration/`。

- 设计完整截图：`reference-desktop.png`、`reference-mobile.png`。
- 实现完整截图：`after-desktop.png`、`after-mobile.png`。
- 桌面分模块对照：`after-compare-desktop-hero.png`、`after-compare-desktop-features.png`、`after-compare-desktop-reviews.png`。
- 手机分模块对照：`after-compare-mobile-hero.png`、`after-compare-mobile-features.png`、`after-compare-mobile-reviews.png`。
- 笔记本叠层近景：`laptop-comparison.png`。
- 未改版工具页：`negative-tool-mobile.png`。
- 测量：`desktop-measurements.json`、`mobile-measurements.json`、`tablet-measurements.json`、`after-desktop-measurements.json`、`after-mobile-measurements.json`。
- 交付预览组合图：`final-preview.png`。

首次配对截图发现以上问题后进行了修正；最终配对截图重新捕获并检查，加载中的空白图片及错误裁切不作为通过证据。

## 功能与保护范围

1. 桌面及平板：布局尺寸、卡片、比较控件、标题与留白通过。
2. 手机：五场景循环、键盘滑块、切换保留比较位置、标签可见、评价暂停/恢复、FAQ 展开通过。
3. Header、已有图片及其他工具页：共享布局、全局样式、上传组件和既有图片文件未改；背景移除页抽查正常，页面字体仍为原来的 16px，没有首页包装类。

项目门禁 `npm run check:ui`：143 项相关单元检查、17 项公共页面检查通过。最后比较标签/手柄的微调后，复用了已通过的公共页面检查，并补跑 6 项首页浏览器检查，全部通过。改动文件 Lint 与最终 diff 检查通过。

## 按授权保留的差异和验证限制

- 按最新授权，效果示例、功能亮点和工具卡片改用设计包实际图片。32 张首页设计素材已逐字节核对一致，其中本轮补换 12 张。Header 和 Footer 继续保持原有实现；步骤区设计仅有占位框，保留现有图片。
- 原有正文、最新指南与真实 FAQ 答案保留，手机文本自然换行可使局部高度不同于设计包缩短后的占位文案。
- 比较区为示意预览；上传与 CTA 沿用已有处理/路由。工具卡片保留真实链接，而非原型中只切换选中状态的按钮。
- 小字和蓝色按钮沿用可读性所需的较深色值；评价保留显式暂停按钮，放在底部留白，不推高内容。
- 本轮不改处理操作、鉴权、Provider 或额度逻辑，不请求真实处理、不消耗线上额度。OAuth、生产 Provider 效果、部署和生产 Smoke 不适用于本地视觉校准，未声称通过。
- 自动检查覆盖严重/关键无障碍问题及操作回归，不等于完整无障碍认证。
- 所有改动仅保存在本地，未提交、推送或上线。

## 历史记录（保留原对象移除验收）

以下为原有记录，不代表本轮重新验证：

### Object Remover design QA

- Reference state: uploaded-image editor from the supplied Object Remover screenshot.
- Compared state: local `/remove-object` editor after uploading the generated desk photo and painting a blue Brush mask.
- Desktop: the workspace expands to the available page width, the landing copy is hidden, the image and manual controls remain balanced, and there is no Auto Removal control.
- Mobile: the image, Brush/Lasso/Eraser controls, slider, correction actions, primary action, and privacy note stack without horizontal overflow.
- Brand adaptation: the reference yellow selection system is intentionally replaced with the site's existing blue action color and a semi-transparent blue mask, as requested.
- Functional visibility: Brush is selected by default, the blue mask remains translucent, and Remove object becomes available only after a non-empty selection.

## Final result

passed

## 本轮素材替换（2026-10-18）

- 替换 3 张效果图、3 张功能配图、6 张工具卡片图；保留旧素材文件供其他页面引用。
- CMS 图片路径和替代文字同步更新，响应式 WebP 已生成。
- 素材契约先红后绿；内容检查 241 项通过，构建及 37 个 HTML 的响应式图片校验通过。
- 桌面 1920 和手机 390 宽检查：可见图片全部加载，无横向溢出。截图：`output/playwright/calibration/assets-desktop.png`、`assets-mobile.png`。
- 本地迭代，未提交、推送或部署。
- 首页桌面/移动端交互回归 6 项全部通过。

## 发布准备

预发布覆盖率门禁发现首页交互仅有浏览器测试，覆盖率不足。补充滑块边界、指针捕获、样例位置继承、场景键盘切换、窄屏标签可见和评价暂停/恢复的状态测试。408 项单元检查通过，语句 82.30%、分支 76.61%、函数 87.50%、行 86.14%，达到原有门槛，未降低标准。


## 2026-10-25 登录头部与首页统一上传复核

本轮源视觉为用户截图及重新捕获的正式首页；在既有视觉系统内修复头部宽度分配、账户操作和首页上传入口，未重新设计素材、字体或页面主体。

- source visual truth path: output/ui-unified-upload/01-production-before.png
- implementation screenshot path: output/ui-unified-upload/02-desktop-after-mocked.png
- viewport: desktop 1864 × 957 CSS px; mobile 390 × 844 CSS px
- source and implementation pixels: desktop both 1864 × 957; mobile final 390 × 844; deviceScaleFactor 1, no resampling in the comparison inputs
- state: source is an existing signed-in production account; implementation is a synthetic signed-in Test Account with a mocked 1/3 balance. Account identity/balance differences are intentional fixtures, not production changes.
- full-view comparison evidence: output/ui-unified-upload/07-desktop-comparison.png (source left, implementation right)
- focused region comparison evidence: output/ui-unified-upload/08-header-comparison.png (source top, implementation bottom), 09-workbench-comparison.png (source left, implementation right)

### Findings and comparison history

1. [P1, fixed] Production navigation, check-in and sign-out wrap. The final desktop capture keeps navigation/check-in on one line; the account button opens a panel with a separate sign-out operation. Narrow screens proactively collapse navigation. Long account names wrap within the panel, not the header.
2. [P2, fixed] The upload rectangle starts 58.390625px below the example. Removing the homepage media selector makes both top edges exactly 401.40625px at the measured viewport (difference 0px). Original examples and comparison interactions remain.
3. [P2, fixed] A unified entry must not force users to choose the media type or imply all operations are free. The final entry accepts supported images/MP4, inspects file contents and MIME, and restores the correct local workspace. Limits, explicit cost action, free-image allowance and video credits are explained separately.
4. [P2, fixed during independent review] Client MP4 identification initially omitted existing supported container brands. Added failing regression cases, aligned admission with the existing server contract, and passed 20 focused tests without changing server validation.

### Required fidelity surfaces

- Fonts/typography: retained Plus Jakarta Sans/DM Sans, existing heading hierarchy and brand assets. Header no longer splits navigation labels; mobile instructions wrap within the card. No actionable P0/P1/P2 typography issue in the final captures.
- Spacing/layout: retained hero art, grid widths and surrounding sections; corrected top-edge alignment. 1920–320px header tests and desktop/mobile homepage tests show no horizontal overflow. Phone upload remains first for discoverability.
- Colors/tokens: retained existing blue/ink surfaces and dashed upload border. Account expanded/focus states use existing tokens. No new color system.
- Image quality/assets: retained the real supplied product illustration, thumbnails and original logo. Generated existing responsive WebP derivatives locally before visual verification; no placeholder accepted as final evidence.
- Copy/content: separate supported image/video requirements and actual cost units. Updated existing CMS fields without schema changes. Image-focused SEO title and example sections remain intentional.

### Verification and remaining limits

Browser-rendered desktop and mobile screenshots were opened and inspected; the full source/implementation pair and both focused comparisons were inspected together. Primary interactions cover account open/dismiss/keyboard, automatic image/MP4 routing, drag/drop, local draft restore, malformed/unsupported/oversize errors and an unaffected background-removal page. The mocked homepage browser error log is empty. Real OAuth/Provider/billing and production export were not exercised; the changes are local only.

14 targeted browser scenarios, 20 focused media unit tests, 144 UI unit checks, and public-page checks are covered. The original public suite had one 30-second all-tool traversal timeout; its first failure was preserved and the single case passed with a one-run 90-second allowance (20.3 seconds). The original check:ui process is not represented as a clean pass. See docs/product/HEADER_UNIFIED_UPLOAD.md for the exact evidence boundaries.

No actionable P0/P1/P2 findings remain in the scoped local UI. Full accessibility compliance is outside this result.

final result: passed


### 发布前补充（2026-10-25）

手机导航与账户面板同时展开时的点击命中红测确认层级遮挡；账户面板增加 z-index:40 后，导航展开时签到/退出均可命中，面板不超出 390px 边界且写请求为 0。头部组合用例与原 3 项共 4/4 通过，验收范围由 13 增至 14 项浏览器场景。发布资产保留和生产部署门禁另见 docs/product/HEADER_UNIFIED_UPLOAD.md。

final result: passed

### CI 回归修复（2026-10-25）

完整 CI 揭示公共导航扩大断点后误伤 App 头部，在 1280px 形成 199px 三行并使画布操作落在视口外。新增负向红测后，以低优先级 `:where(:not(.workspace-header))` 限定公共折叠规则；图片/视频工作区在 1280/1024px 保持单行，公共手机菜单不超出右边界，头部 5/5 通过。既有手机签到测试改走账户面板，继续验证一次点击仅增加一次余额。原画布测试不修改、不通过滚动掩盖回归。上述定向浏览器场景增至 15 项；最终发布状态另行记录。

---

# Image-credit pricing layout QA — 2026-10-31

Scope: adapt the account holder's selected four-column pricing reference to WatermarkGemini's existing brand and approved one-time credit packages. This is visual and interaction acceptance, not Live payment acceptance.

Source visual truth: `output/pricing-design/reference.png` (the supplied HitPaw screenshot, 1680 × 957). Implementation: `/app/credits`, using the real approved catalog with checkout closed and no payment credentials in the local preview.

## Evidence and normalization

- Desktop CSS viewport: 1680 × 957. Chrome's captured PNG is 1665 × 948; the comparison normalizes it proportionally to 1680 × 957.
- Mobile CSS viewport: 390 × 844. Captured PNG: 375 × 812; the full-page capture is 375 × 3979. No horizontal overflow was observed.
- Before/final captures: `output/pricing-design/desktop-before.png`, `desktop-final.png`, `mobile-first-screen.png`, `mobile-final.png`.
- Full-view combined comparison: `output/pricing-design/desktop-comparison.png`. Focused card comparison: `output/pricing-design/cards-comparison.png`. Both the reference and implementation were opened together before the final judgment.
- The in-app browser could not attach. The existing Chrome connection was used for the local design check; no PayPal or Google account interaction was performed.

## Findings and comparison history

1. Initial P2: the duplicate back link, extra eyebrow and long introduction pushed the cards substantially below the reference's first-screen composition. Removed the desktop-only duplication and eyebrow, shortened the introduction and tightened hero spacing. The final same-size comparison confirms aligned title/card hierarchy and visible prices and actions. The additional closed-checkout notice is an intentional release state; it is absent when checkout opens.
2. No remaining actionable P0/P1/P2 visual differences. The reference's subscription names, ratings, struck-through prices and seasonal promotion are replaced by the actual Free / Starter / Plus / Pro offer and one-time-payment disclosures. The recommendation and the selected package have distinct states.

## Required fidelity surfaces

- Typography: existing Plus Jakarta Sans display and DM Sans body fonts; large price hierarchy, aligned plan labels, readable descriptions and feature lists. Copy length differs intentionally from the reference.
- Layout: four equal rounded cards on desktop, two columns at tablet width, one column on mobile; consistent action baselines, feature dividers and card padding. Mobile header controls remain visible.
- Color: existing navy, blue action/text and pale-blue surfaces. Plus uses the brand blue with white content. Focus/selection have visible native radio and border states.
- Images and icons: existing WatermarkGemini logo and installed Lucide icon families. No reference brand, promotion image, fake rating or replacement artwork was introduced.
- Content: API-backed USD prices and 4,990 / 9,990 / 19,990 credits; eligible-tool costs 100 / 10 / 10; free uses are independent and take priority. PRO, refinement and video remain excluded.

## Interaction and verification boundaries

- Choosing Plus updates the native radio and purchase review to 9,990 image credits / USD 9.99. Choosing a package creates no order; the free link navigates to the image workspace without creating an order.
- Closed checkout has no PayPal SDK/payment action. Existing order recovery and refund controls remain in place.
- New layout regressions first failed with three cards. The first combined payment run passed 21/22; an existing reload case reached its assertion before development modules finished loading. The unchanged case and both new layout cases passed the isolated final run (3/3, original timeouts).
- Chrome logged one unattributed storage-access message during the preview. No corresponding project exception or broken interaction was observed in the automated trace; real Google sign-in remains a separate release gate.
- Real purchase, signed callback delivery, paid-credit processing and refund acceptance remain pending. They are not implied by this design check.

final result: passed

## Incognito first-render regression — 2026-10-31

The production report showed zero package cards in the first HTML response, followed by a loading message and prematurely anonymous order history. Request rendering now emits the approved public catalog before browser code runs; only an explicit public whitelist is serialized. The client still confirms the latest catalog before loading PayPal, and pending session checks use a neutral status.

- Desktop 1680 × 957 and mobile 390 × 844 were inspected in Chrome. Captures: output/pricing-first-render-desktop.png and output/pricing-first-render-mobile.png; mobile content width 375 at viewport 390, with no horizontal overflow. Four cards remain present during pending checks.
- The supplied source and current desktop capture were normalized and opened together in output/pricing-first-render-comparison.png. Typography, four-card hierarchy, spacing, brand colors, logo/icons and approved one-time-purchase copy remain consistent with the accepted layout. No CSS or reference assets changed in this fix; no actionable P0/P1/P2 visual issue remains.
- New raw-HTML and delayed-network tests first failed on zero cards. The corrected page renders four cards, sends one catalog request and keeps measured section geometry within 2px. The enabled dummy-Sandbox check confirms zero SDK requests before catalog confirmation, exactly one afterward, and zero create/capture requests.
- Full local release verification passed audit threshold, 1,074 unit tests (9 database opt-ins skipped), coverage, lint, Astro checks and build. Its parallel browser run preserved 95 passes / 6 failures / 1 opt-in skip. The six unchanged failures passed once serially at their original timeouts; traces showed delayed development hydration/refresh. The enabled SDK opt-in passed separately using dummy local credentials only. This is not represented as a one-shot clean full gate; required PR CI remains separate.
- Nineteen audited retained application assets preserve all previous nine entries plus production615 dependencies. Retention tests 9/9 and the actual App artifact build passed. Local artifacts are not deployed as Windows-built App functions.
- Chrome again logged two unattributed storage-access errors in this existing profile; cards and sign-in checks completed, and no corresponding application exception appeared in focused automated coverage. Real payment, signed Live callbacks, paid processing and refund remain separate user-gated acceptance.

final result: passed

## 工具落地页 v16 本地迭代（2026-10-31）

本节只记录本轮工具页，保留以上历史首页验收记录。工作区为 canonical `teddy920810/ai-watermark-remover`，本轮从 `main@5be42381` 开始；既有首页、账户、支付和处理流程改动未被覆盖。未提交、推送或部署。

### 范围和交互契约

- 20 个公开工具页和 1 条草稿共用新布局；各页保留独立标题、流程、FAQ、图片、上传文案和处理类型，保留 Coming Soon。
- 示例选择与前后对比仅改变本地展示，不选择上传文件、不创建 job、不改变余额。真实流程仍由三个既有 uploader 完成：选图、必要时登录、上传、处理、结果和下载。
- 首屏样例、Feature 比较图、相关工具与指南由各页 CMS 配置。清空关联 slug 列表恢复自动选择；草稿和未开放工具不进入可用工具卡片。指南使用真实博客路由。
- Gemini 配置 3 个首屏样例及 4 组 Feature 比较；原前三组 Feature 文案和原图字段保留。其他工具的既有拼接对比图继续静态显示，不再叠加虚构水印；可在 CMS 提供真实前后图启用滑块。

### 参考与截图证据

- 参考源码：`E:/xwechat_files/sy236577346_7b05/msg/file/2026-10/gemini-watermark-remover-optimized-release-v16/outputs/gemini-watermark-remover-optimized/index.html`，同目录 CSS、交互脚本和 assets。
- 六张新增原图与设计包 SHA-256 全部一致；响应式衍生图已生成。
- 当前本地预览：`http://127.0.0.1:4386/gemini-watermark-remover`，HTTP 200，包含 3 个 Hero 与 4 个 Feature 比较。
- 浏览器实现截图：`output/tool-landing-v16/gemini-desktop.png`、`output/tool-landing-v16/gemini-mobile.png`，状态为匿名、首屏第一个样例、滑块 50%。实际文件尺寸为 1905×890 和 375×812；截图请求尺寸为 1920×1080 和 390×844，浏览器实际输出不同，未做密度归一化，不能作为 1:1 对照。
- 功能测试使用的浏览器视口为桌面 1440/1920 与手机 390；Feature 测试为 1920×1080、390×1080。
- 原稿 `file://` 的浏览器访问被安全策略拒绝，未绕过。后续浏览器连接超时，未补拍最终完整页面。缺少可打开的原稿参考截图，未形成原稿与实现的同视口拼图，整页和局部的视觉对照均未通过验收。

### 已检查的五项表面及有意差异

- 字体：沿用 DM Sans 和 Plus Jakarta Sans；按源码迁移标题、行高和字号，并保留 Gemini 的分行。已查看实现首屏，原稿实际换行仍待同视口对照。
- 布局：1160px 首屏工作区、1200px 内容区、步骤、交替 Feature、卡片、双列指南及窄屏堆叠已实现；保留原 header、公共 CTA/footer 及工作区展开契约。精确间距的原稿对照待补。
- 颜色：延续原蓝色系统；小字、步骤数字、After 标签及工具 CTA 略微加深；Feature 水印徽标增加深色底以满足可读性。属于明确的可访问性差异。
- 图片：新增素材来自设计包，保留原有页面素材；真实图片加载、非占位图及滑块 0%/100% 裁切已通过测试。原稿裁切与密度对照待补。
- 文案：各工具既有内容独立保留；Gemini 第四块按实际免费余额、Google 登录、每日签到及私有存储说明撰写，未复制设计包中不符合实际的 “no credits to purchase”。

### 验证及修复历史

- TDD：CMS/model、Feature 新配置、可用工具过滤和空列表语义均有先失败后通过的测试；最新模型 32 项通过。内容相关三文件曾完成 136 项通过。
- 新浏览器行为：首轮 4 项通过，覆盖桌面/手机示例切换、指针/键盘、背景/物体选图展开与重置、独立 FAQ、真实链接、Coming Soon 和首页负向区域；确认无上传/处理请求。增加的四组 Feature 目标也先红后绿。
- 一次标准 `check:ui`：144 项单元通过；公共页面首轮 15/18 通过。失败涉及博客循环并发超时、旧 FAQ 简介可见性断言以及小字对比度，首次证据保存在 `output/tool-landing-qa/first-check-ui-failure/`。
- 修复：FAQ 按新设计隐藏简介，但断言仍锁定各页独立文本；20 页循环扩大到 90 秒；逐项修复对比度。博客单项串行复核通过，20 页流程/FAQ 和 Hero 图片/交互复核通过。
- 最后两项定向复核通过：全部公开页面和 404 无 serious/critical 可访问性问题；4 组 Feature 在桌面/手机使用正确图片，实际加载并完成 0%/100% 裁切验证。Feature 导航使用 DOMContentLoaded，再逐图等待，避免把外部 GA 脚本 Pending 当作页面失败，未放宽图片或交互断言。
- Astro 等价类型检查：排除工作区既有 `output/` 临时副本后，217 文件、0 errors；项目 tsconfig 未修改。定向 ESLint 和最终 diff 检查通过。
- 以上为本地代码和功能证据；未修改 API、Provider、鉴权、R2、环境或域名，相关生产 gate 为 not applicable。未触发付费处理或 Production Smoke。

### 当前结论

本地功能验证通过；原稿与实现的同视口视觉对照仍受参考截图缺失及浏览器连接问题阻塞。

依据 `product-design/skills/design-qa/SKILL.md`：“If either artifact cannot be opened, captured, or compared, write `design-qa.md` with `final result: blocked` and name the blocker.” 后续需可访问参考画面与最终实现截图，按同视口、同状态对照后才能标记视觉验收通过。

final result: blocked

### 用户发布授权与远端基线保留（2026-10-31）

用户在查看本地预览及上述视觉限制后明确指示“提交上线”。发布工作转入隔离分支 `codex/tool-landing-v16`，基于 `f6d26c9` 移植本轮工具页增量；上述旧本地验证数字与静态 uploader 描述仅记录当时基线，不能替代发布分支验证。

发布版保留远端最新 `MediaLauncher`、图片/视频工作区跳转、视频已开放状态与既有处理能力，schema 保留 `video-watermark-remover`；9 个 Coming Soon 与两条草稿不因改版改变。API、Provider、账户权益、PayPal、鉴权、环境、域名及首页既有实现均不属于本次发布改动。发布分支将单独记录 CI、部署与生产只读验证结果。

用户上线指示没有把缺失的原稿同视口截图对照转为已通过；原稿视觉比较限制继续保留，不能以代码检查或部署状态替代。

final result: blocked

### 发布分支验证与兼容修正（2026-10-31）

- 首轮发布 CI 的单元、类型、Lint、构建与独立 Site/App/Worker 产物通过；E2E 保留首次失败及重试证据：手机物体移除测试从固定顶部栏遮挡的位置绘制，未生成选区，按钮因此保持禁用。
- 增加可重复该滚动位置的红测，修正测试准备：等待图片与画布就绪、滚入可见区域并确认指针命中，再绘制真实选区并检查非空像素。原费用同意和提交载荷断言保留；相关 5 项测试通过。产品处理和费用代码未改。
- 发布前公共资源清单与 Site CI 产物比较发现两份旧哈希 CSS 缺失。将生产已公开的原始字节保留在 `public/_site-assets/`，兼容已打开页面；本目录禁用 CSS 换行转换。新增文件大小和 SHA-256 回归先红后绿，两项通过。未改变部署配置。
- 完整 PR CI、合并后生产部署及公共页面只读验收仍分别记录；上述修正不代表原稿同视口视觉比较已通过。


## 免费 Gemini 图片与视频本地实现 — 2026-11-08

本节仅评估 PRD v1.1 与第三组结果页，不改写以上历史验收。本地版本未提交、未发布。

### 参考和比较方法

- 来源：C:/Users/ermei/.codex/generated_images/01a1ba4a-cdf9-7f91-a363-e990885b8363/exec-c802b2f4-e042-41e7-80de-e45e48f03c5b.png，1983×798 设计板。
- 分别裁取图片/视频页面框：x=13/999、y=66、970×714，去掉设计板标题和外框；原稿未提供 CSS 视口。实现使用 970×714 CSS px、DPR 1，完整页分别 970×942/868；不拉伸高度，用留白对齐，两侧同为 970px。不能把生成稿当作精确 CSS 标尺。
- 第一次整页同输入比较：output/gemini-free/image-design-comparison.png、video-design-comparison.png。聚焦标题/下载比较：image-header-comparison.png、video-header-comparison.png。上述参考与实现已一起打开检查。
- 另有 1440×1024 桌面和 390×844 手机截图：image-desktop.png、video-desktop.png、image-mobile.png、video-mobile.png，均在 output/gemini-free/。图片/视频来自明确的校准测试夹具，调用真实本地引擎；设计海岸图仅说明布局，不能伪装成引擎效果证据。

### 第一轮发现

- [P2] 970px 下结果标题约 33px，弱于参考的标题层级；88px 页头和64px顶部间距把媒体区推至 y≈299，参考约249。需要减小顶部留白、增大结果标题和主要下载按钮，重新截图比较。当前标记 blocked，不能以构建通过替代。
- 意图差异：真实媒体按原比例 contain，不裁剪方图来匹配样例海岸图；账户无头像时显示实际姓名首字母与退出操作，保留实际品牌资产；增加原文件云端上传/费用说明、重新编码范围、可展开的完整开源许可及引擎 best-effort 提示。付费入口仍弱于免费下载。

### 已检查的五项表面与交互

- 字体：Plus Jakarta Sans/DM Sans 沿用网站；待修复上述窄桌面标题比例。动态尺寸/音轨信息来自实际文件。
- 布局：双栏、左标题右免费下载、共享视频控制与弱付费位置正确；待修复顶部节奏。手机改为原片/结果切换，下载占满可用宽度。
- 颜色：沿用网站蓝/深蓝/灰色变量，绿色说明图标，视频深色控制栏；不添加促销卡片或付费弹窗。
- 图片：原品牌 Logo，实际原文件与处理 Blob 预览；源图/视频场景与设计示例不同是明确的动态内容差异，未把样例截图烘焙到产品。
- 文案：免费下载优先，不宣称任意水印、无损视频或付费必然改善；原公开 SEO 内容保留并登记发布前审核。
- 浏览器自动检查覆盖真实 PNG/MP4 下载、图片透明度、视频音轨与共享控制、取消重试、无支持水印、登录保留文件、签入后主动开始、原文件跨页、账户/期限/UNKNOWN 保护、刷新无自动收费。会话和云端环节受控模拟，不冒充真实 OAuth/收费验收。
- 通过 in-app browser 手动选取本地校准图片：预览正确、显示登录后免费处理，控制台 warn/error 列表为空。没有执行真实 Google OAuth。整站 E2E/组件回归仍在运行，最终数字另补。

final result: blocked


### 第二轮比较与本地结论

第一轮文件以 before-image-/before-video- 前缀保存在 output/gemini-free/，未覆盖。修正页头为72px、主区顶部48px、标题最大46px、主要下载按钮56px高/至少300px宽，并收紧标题区下方间距。手机单独取消按钮最小宽度，320px到1440px均保留主要操作。

已重新打开 image-design-comparison.png、video-design-comparison.png 与 video-header-comparison.png，参考和修正版处于同一输入。970px下媒体顶部从约299移至约253，接近参考约249；标题与下载层级恢复。修正版完整图片/视频页为970×896/822，仍以970 CSS px、DPR1对照；多出的高度来自真实比例保留、风险/上传说明、使用范围及许可，未拉伸媒体或把设计图伪装成真实结果。

五项表面复核：字体/标题、网格节奏、现有品牌色、原Logo与真实媒体预览、必要产品文案均可接受。390px手机图片/视频截图已打开检查，320px实际浏览器断言无横向溢出；视频切换前后保留定位，音轨仅从结果播放。无剩余可执行P0/P1/P2视觉问题；生成稿的账户照片与校准素材不同已明确区分，不作为恢复真实Gemini样本的承诺。

最终增量浏览器验证15/15通过：11项Gemini场景，以及4项整站首失败复核；独立图片展示组件4/4通过。整站首轮为207通过、4失败、1可选跳过，保存在 release-build-browser.log；其中两条旧测试按批准的Gemini免费入口更新，两条未改产品业务代码的公共页面场景以原时限串行通过。不把组合复核描述为全量一次通过。

完整单测为160文件、1411通过、15个既有可选跳过，覆盖率达到既有阈值。新引擎首次覆盖率运行的两项超时、测试夹具类型错误及后续会话到期/无支持水印红测均保留日志；修正后最终Lint、Astro检查（0 errors/0 warnings）、组合构建和68份HTML响应式图片验证通过。之后的会话保留、失败交接与视频负例由新增操作级浏览器红绿覆盖。

真实Google OAuth、授权原始Gemini样本、macOS/Linux/真实手机、真实云端付费/购买、生产GA信号与来源到购买归因及SEO/隐私审核仍是单列发布前门禁，未假称通过。本轮仅本地开发和模拟链路验证，不提交、不推送、不发布。

final result: passed


## 免费 Gemini 发布与工具页原视觉保护 — 2026-11-08

用户已授权上线，并明确原工具页视觉不变。发布版移除未上线的 FreeGeminiLauncher，复用原 MediaLauncher；原公开 JSX、文案、图标以 main@8abae404 的独立 SHA-256 基线锁定，仅修改跳转目标与本地文件交接。新入口在 route-policy.mjs 中明确登记，不以页面名称猜测。

生产发布前同账户0 Credits截图：output/gemini-free/release/landing-before-auth-desktop.jpg（1440×1000 CSS px）及 landing-before-auth-mobile.jpg（390×844 CSS px）。另保留匿名基线。界面其余源码、SEO JSON、FAQ、图片和alt均保留原值。首屏/页尾的图片/视频4项原字节交接浏览器场景已通过；最初冷启动导航等待不足的日志及追踪保存在 entry-first-failure，修正为等待真实导航完成后4/4通过。

最终合并后的同尺寸生产视觉比较与功能门禁另行补记；此节不把本地结果当成已上线。

final result: blocked
