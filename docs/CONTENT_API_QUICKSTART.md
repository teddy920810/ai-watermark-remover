# 内容运营：从草稿到发布

接口：`https://www.watermarkgemini.com/api/content/v1`。使用管理员安全交付的内容 Token；不要贴到聊天、浏览器或请求参数里。完整接口、错误与恢复规则见 [技术合同](CONTENT_API.md)。

1. 先 GET `/schema` 和 `/templates/blog` 或 `/templates/landing`。更新旧稿先 GET `/entries/{kind}/{slug}`，保留完整字段和原 URL。
2. POST `/changes` 创建变更集。上传原图到 `/changes/{id}/assets`，把**返回的完整 `asset.path`**写入同一变更集的稿件；返回路径不代表已上线。
3. 完整 PUT 稿件，POST `/changes/{id}/validate`。每次写操作使用新的 `Idempotency-Key` 和带引号的 `If-Match` revision；失败重试沿用原 key、JSON 和 revision。
4. 检查正文、SEO、图片、alt 和具体差异。真实文章公开前设 `draft:false`；测试稿保持 `draft:true`。读取最新 digest，再 POST `/review` 提交对该版本的明确批准说明。
5. 查看返回 PR，等待 `verify` 和 `Required target artifacts` 对同一 head 成功，再 POST `/publish`。保存不等于批准，合并不等于上线。
6. GET 变更直到 `published`，核对实际页面/图片及手机显示。草稿仍应 404、无 sitemap 收录；`published` 仅证明 Site 已包含该版本。

纯内容及严格单一新变更集审计可走内容检查；已有审计 ID、独立基线、源码、混合或无法核实的变化仍走完整检查。某条坏 JSON/schema 可能阻止整个静态站构建，不能跳过内容校验。无需重新配置既有凭据或调用付费处理来发布内容。

## 完整 JSON 与本机草稿示例

- [Blog Markdown](examples/content-api/blog.json)：封面和正文静态图，含全部通用元数据。
- [Blog 安全 HTML](examples/content-api/blog-html.json)：`contentMode:html`、`bodyHtml`，Markdown `body` 为空。没有可执行 MDX 或结构化比较块。
- [工具落地页](examples/content-api/landing.json)：首屏、示例、按钮、三步配图、功能、范围、关联工具、指南、FAQ、CTA，以及旧 uploader 文案组。`uploader` 仅保留旧记录兼容，当前 Launcher 不消费它；修改它不会改变 App 控件。

这些 JSON 均为未公开草稿，仅放在文档目录。先复制为自己的稿件，替换事实、slug 和准确图片说明，勿拿模板覆盖旧文章。

在项目根目录用 Node 22/24 执行 [草稿脚本](examples/content-api/draft.mjs)：

```sh
node docs/examples/content-api/draft.mjs --document docs/examples/content-api/landing.json --image authorized-source.png --out output/operator-draft.json
```

脚本仅创建/上传/保存/校验草稿，不自动批准或发布。Token 从受保护文件读取。中断后保持相同输入和 `--out` 重跑，恢复文件保存原请求键、revision、完整上传结果及最终 JSON；换输入另选恢复文件，保留旧记录。

## 真正的双图比较

落地页的 `heroSamples`、`features.items`、`process.steps` 使用 `image`（Before）与 `afterImage`（After）；只有 `image` 时是静态图。Blog `coverImage` 仍是单张封面。

先备好同一构图的真实输入和真实结果两个独立文件，每张不超过 2,000,000 字节、每边不超过 6000 像素、总像素不超过 24,000,000，单帧 JPEG/PNG/WebP。人工确认对齐与真实性；尺寸校验无法证明这一点。不要从合成对比海报裁出伪前后图，不改原文件字节或为了示例发起付费处理。

```sh
node docs/examples/content-api/draft.mjs --document docs/examples/content-api/landing.json --before authorized-before.png --after authorized-after.png --aligned-pair-confirmed --out output/operator-pair-draft.json
```

脚本分别上传两个原文件，保留两份完整 `asset` 返回对象，将返回路径填入三个实际比较模块，再校验并保存草稿。JSON 内不放假上传 ID 或不存在的 after 图。本仓库示例默认使用已有静态图；尚未提供可公开引用的合规真实双图时，须由内容负责人提供这两个源文件，不能声称示例比较已完成素材验收。
