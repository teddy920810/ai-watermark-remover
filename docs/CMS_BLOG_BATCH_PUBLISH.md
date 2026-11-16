# 后台博客批量发布

## 内容编辑

1. 在 Pages CMS 左上角选择 `codex/cms-blog-editing`。`main` 只用于查看线上源码，不能直接保存。
2. 编辑任意多篇博客并分别 **Save**。新博客可用列表的 **Add an entry / New**，填写完整内容；草稿开启表示不公开，关闭表示公开。上传栅格配图后再保存文章引用。Save 只保存，不启动发布检查。
3. 逐篇核对本批正文、图片、SEO 和上下架状态后，点击侧栏 **批量发布已保存的博客 / Publish saved blogs**，在确认框批准本分支全部已保存的博客差异。
4. 后台 Actions 查看进度与结果。系统在发布任务启动时读取并冻结编辑分支版本，创建一个发布PR，等待 `verify` 和 `Required target artifacts`，通过后合并并等待正式Site。失败时沿原PR处理；编辑分支没有新保存时，重跑复用该批，不重新发稿。
5. 显示“批量发布完成”后刷新编辑页，再开始下一批。从点击发布到本批完成期间请暂停编辑；任务启动后的新保存留待下一批；分支同步使用合并，不强制覆盖。并行修改同一处导致冲突时停止并保留内容，需要维护者处理。

每次按钮只覆盖博客 Markdown 与 `public/uploads` 下的 PNG/JPG/WebP/GIF/AVIF。工具落地页、站点设置、代码、MDX、SVG、删除及重命名不进入批量自动发布；需要其他类型时沿原审核流程。临时下架使用草稿开关，保留原文和图片。原模板新建入口仍创建单独审核草稿；要与本批一起发布，请在固定编辑分支使用 New。

## 一次性设置

- 工作流：`.github/workflows/cms-publish-blog-batch.yml`，只从受保护 `main` 运行可信脚本。Pages CMS 按[官方 Actions 合同](https://pagescms.org/docs/configuration/actions/)传递编辑分支和工作流SHA；[官方实现](https://github.com/pages-cms/pages-cms/blob/main/app/api/%5Bowner%5D/%5Brepo%5D/%5Bbranch%5D/actions/route.ts)中的 `repository.sha` 属于 `workflowRef`，不能作为博客版本，脚本在任务启动时单次读取编辑分支SHA并固定本批，按钮固定 `ref: main`，不运行编辑分支内的程序。
- GitHub Actions Secret `CMS_PUBLISH_TOKEN`：仅选当前仓库的 fine-grained PAT，Contents 和 Pull requests 读写、Checks 只读、Metadata 默认只读；不授予 Workflows 或主分支保护绕过权限。Token 有效期由维护者管理，过期时发布停止，不影响已上线内容。不要复制本机宽权限凭据或将Token放进代码、日志、浏览器字段。
- 专用凭据用于创建PR、触发现有检查和合并。默认 `GITHUB_TOKEN` 创建PR可能要求人工批准工作流，因此不用于该自动链路，见[GitHub 官方说明](https://docs.github.com/en/actions/concepts/security/github_token)。不修改保护规则，不增加第三项合并门禁。
- 首次交付后从最新main创建 `codex/cms-blog-editing`。该分支持续保留；每批使用独立快照分支，GitHub原生删除已合并的快照分支，编辑分支不会作为PR头被删除。

## 检查与批准边界

按钮的确认是内容负责人对任务启动时已保存版本全部博客差异的明确批准。PR记录源SHA、主线SHA、触发身份、工作流与文件清单；后续保存不改变此次批准。独立SEO基线只同步这次实际修改的既有受保护博客，批准记录指向不可变的源版本，工作流/PR保留本次批准审计；普通Save不会更新基线。

编辑分支和本批快照分支的Vercel Preview构建被精确跳过，普通开发分支与main生产部署不变。批量准备不重复执行检查，统一复用PR现有两项门禁。普通博客/栅格内容走现有内容路径；涉及受保护基线时仍按当前矩阵完整验证，不能为提速降低覆盖。发现发布分支内容与源版本批准不一致时拒绝合并。内容来源分支只允许普通文件和博客/栅格路径，即使碰巧与main内容相同也不接受来源分支额外的程序修改。

正式Site的静态 `/cms-build.json` 只公开构建Git SHA，不含草稿内容或凭据，设为noindex。发布工作流核对该SHA已包含本次合并，再检查全部改动文章的200/404；部署或验收失败时摘要明确区分“PR未合并”和“已合并但正式站未确认”。正式站验收成功后才同步编辑分支，验收失败保留原编辑SHA，重试继续同一已合并PR的验收。已合并内容不会因验收失败自动回滚，也不会重复创建PR。域名、OAuth、R2和Provider在纯内容发布中不重复验收。

正文有带转义的特殊字符时，请使用 Source 模式编辑并核对；实测当前 Pages CMS 富文本往返可能丢失转义下划线，发布器不改写正文。

## 初始启用验收

维护者使用后台真实按钮完成一次多文章草稿保存/批量发布，验证保存不发版、单批复用同一PR、检查通过才合并、正式Site版本与全部文章状态。使用无修改的重复点击确认没有额外构建；用下一次编辑证实固定编辑分支仍可保存。验收草稿始终不公开，不改既有运营正文。
