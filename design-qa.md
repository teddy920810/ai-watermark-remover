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
