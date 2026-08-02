# Pages CMS 中文操作教程（非技术人员）

Pages CMS 是本项目的内容后台。它直接读写 GitHub 中的内容文件，不需要安装 WordPress，也没有单独的内容数据库。点击保存后，会产生 GitHub 提交，并触发 Vercel 自动发布。

## 1. 登录并选择项目

1. 打开 [Pages CMS](https://app.pagescms.org)，选择 **Sign in with GitHub**。
2. 使用已获得仓库权限的 GitHub 账号登录并授权 Pages CMS。
3. 选择仓库 `teddy920810/ai-watermark-remover`。
4. 确认分支是 `main`。
5. 左侧会显示 **博客文章 / Blog posts** 和 **工具落地页 / Tool landing pages**。

若看不到仓库，请让管理员在 GitHub 为该账号添加仓库权限，或检查 Pages CMS GitHub App 是否已获准访问该仓库。

## 2. 修改博客文章

1. 进入 **博客文章 / Blog posts**。
2. 点击已有文章标题。
3. 修改标题、SEO 描述、发布日期、阅读时间或正文。
4. 检查必填项和预览。
5. 点击 **Save** 保存。

重要字段：

- **URL 路径（slug）**：只允许小写英文字母、数字和连字符。文章发布后不要修改，否则旧链接会失效。
- **SEO 描述**：建议 120–160 个字符，准确概括页面内容，不要堆砌关键词。
- **发布日期**：使用界面日期选择器。不要手工粘贴带时区的复杂日期。
- **正文**：合理使用二级、三级标题；不要从 Word 直接粘贴复杂样式。

## 3. 新建博客文章

1. 在博客列表点击 **New**。
2. 先填写 URL 路径，例如 `how-to-clean-an-image`。
3. 填写标题、SEO 描述、发布日期和阅读时间，例如 `5 min read`。
4. 完成正文，检查标题层级和链接。
5. 保存并等待 Vercel 构建成功。

保存前建议让另一位共创者检查事实、版权、拼写和 SEO 描述。

## 4. 修改或新建工具落地页

进入 **工具落地页 / Tool landing pages**，可维护：

- SEO 标题和描述
- 页面小标题、主标题与简介
- 优点列表
- 常见问题及答案

新建页面时，URL 路径会决定正式地址，例如 `remove-stamp-from-image` 对应 `https://watermarkgemini.com/remove-stamp-from-image/`。发布后不要更改 URL 路径。新建的落地页会自动使用现有页面模板；若需要不同布局，请联系开发者修改代码。

## 5. 上传图片

编辑器中的媒体文件会保存到 `public/uploads/`。上传前：

- 确认拥有图片版权或使用授权。
- 优先使用 WebP/JPEG，压缩后再上传。
- 文件名使用小写英文、数字和连字符，不含空格和中文。
- 不上传用户原图、内部资料、密钥、身份证件等敏感内容。

## 6. 保存后如何确认发布

保存并不代表页面立刻上线，通常需要等待 Vercel 完成构建：

1. 在 GitHub 仓库确认出现 `content(create)` 或 `content(update)` 提交。
2. 打开 Vercel 项目 **Deployments**。
3. 找到最新 Production 部署。
4. 状态为 **Ready** 后，打开正式站点并强制刷新页面检查。

状态说明：

- **Ready**：发布成功。
- **Building**：仍在构建，稍后刷新。
- **Error**：内容格式或构建出错，不要反复保存；把错误截图和文章名称发给开发者。
- **Blocked**：通常是提交者身份未被 Vercel 识别，需要管理员检查 GitHub/Vercel 账号或 Pages CMS 提交身份。

## 7. 出错与回退

- 页面文字有误：在 Pages CMS 修正并再次保存。
- 构建失败：上一版生产站一般仍可访问。保留错误部署，不要删除记录，联系开发者查看 Build Logs。
- 需要撤销整次修改：请开发者在 GitHub revert 对应提交。Pages CMS 已关闭重命名和删除操作，避免非技术人员误删内容或改变 URL。

## 8. 发布检查清单

- 标题和描述准确，无夸大功能；当前处理器仍可能返回原图。
- URL 路径格式正确，已发布页面没有改动 URL。
- 正文图片有授权、体积合理、无敏感信息。
- 链接可以打开，移动端段落不过长。
- Vercel 状态为 Ready，正式域名页面已核对。

Pages CMS 官方说明见 [pagescms.org/docs](https://pagescms.org/docs/)。
