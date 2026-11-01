# SEO 运营 Agent 内容 API

本接口只管理工具落地页、Blog 和运营公共素材。内容权威仍是 Git；每个变更集保存在 `codex/content-{id}`，内容和素材经同一 PR、必需 CI、受保护 main 和 Site 部署生效。App 提供 API，SEO 页面继续由 Astro 静态生成。接口不提供处理任务、用户私有媒体、权益、报价、Provider 或任意文件写入权限。

代码提供接口不代表生产已启用。启用必须完成下述专用凭据配置及真实草稿验收；未配置时拒绝请求，不能把模拟测试称为生产可用。

## 部署和安全前置

1. 部署包含本接口的 App 和 Site 版本。保留现有 Google/R2/支付配置，内容服务不用这些凭据。
2. 仓库维护者在 GitHub 创建**只选 `teddy920810/ai-watermark-remover`** 的 fine-grained PAT，或等价的专用 GitHub App installation token。写入凭据权限为 Contents read/write、Pull requests read/write、Metadata read；不授予 Workflows write，不设主分支保护绕过身份。若采用有时效的 installation token，需要部署方提供自动续期，不能把即将到期的安装 token 当长期配置。首版最简单的是有明确到期日的单仓库 PAT。
3. 将仓库凭据仅作为 App **Production Secret** `CONTENT_GITHUB_TOKEN` 保存。不得复制本机宽范围个人 token，不放入 Site、浏览器、Git、请求示例、截图或日志。GitHub 的文件权限不是路径级权限，服务端另行强制内容路径白名单，main 保护继续作为外部门禁。
4. 在维护根目录运行 `node scripts/content-api-token.mjs`，生成 32 随机字节的 Bearer Token。脚本只写 Git 忽略的 `.secrets/content-api-token.txt` 和 `.sha256`，不打印 token，已有文件时拒绝覆盖。用密码管理器把 token 交给被授权的内容负责人/Agent；该持有人有内容修改和批准发布权限，应先审阅具体差异再调用审核接口。
5. 把 `.sha256` 文件中的摘要设为 App Production Secret `CONTENT_API_TOKEN_SHA256`；设非秘密标识 `CONTENT_API_ACTOR`，如 `seo-editor-01`。摘要不能当 Bearer Token 使用。Preview 使用独立 token 和隔离凭据或保持关闭，不能继承 Production 凭据。
6. 新环境变量需要重新部署 App。运行文末的真实草稿验收。不要将秘密贴进聊天或命令行参数；通过受保护文件/密码管理器交付。密钥创建、撤销、到期时间由维护者管理。

轮换：先把现有 token 和摘要安全保留为旧版本（密码管理器或忽略目录中的其他受保护文件名），确认生成脚本的两个目标文件名均不存在后，再运行同一脚本生成新一组；不要覆盖或删除唯一副本。将旧摘要暂设 `CONTENT_API_PREVIOUS_TOKEN_SHA256`，新摘要设主值，重新部署并把新 token 安全交付；确认 Agent 已迁移后删除旧摘要并再次部署。发生泄露时立即撤销旧摘要和相关仓库凭据，不保留兼容窗口。轮换不改变 `CONTENT_API_ACTOR`，避免改变创建请求的幂等命名空间。

官方合同：[GitHub Git trees](https://docs.github.com/en/rest/git/trees#create-a-tree)、[引用更新](https://docs.github.com/en/rest/git/refs#update-a-reference)、[fine-grained PAT](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)、[Vercel 环境变量](https://vercel.com/docs/environment-variables)、[函数请求体限制](https://vercel.com/docs/functions/limitations#request-body-size)。

**Checks 读取与写入凭据分开。** GitHub 明确列出 [fine-grained PAT 不支持 Checks API](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#fine-grained-personal-access-tokens-limitations)。当前仓库为 public，按 [公开 Checks 无鉴权读取合同](https://docs.github.com/en/rest/checks/runs?apiVersion=2026-03-10#list-check-runs-for-a-git-reference)，服务端只读固定仓库和精确 SHA，不携带 Authorization 或内容写凭据；仍核对返回 head、GitHub Actions app15368 和两个必需检查。403/404/429/异常/限流均阻塞发布，不回退到宽权限 token。查询审核状态不要高频轮询，建议至少间隔 120 秒并在限流时退避。若未来仓库改为 private，必须先重新配置官方支持 Checks 的受限凭据合同；当前匿名路径会拒绝放行，不能沿用 PAT 并误报通过。

## 通用协议

生产前缀为 `https://www.watermarkgemini.com/api/content/v1`。全部端点需要 `Authorization: Bearer <token>`，响应不缓存、不索引，不支持用 Google 会话或查询参数代替 token。

写请求使用 `Content-Type: application/json`、8–128 字符的 `Idempotency-Key`（ASCII 字母/数字/下划线/连字符）。除创建变更集外，还需要 `If-Match: "<revision>"`，包含双引号。revision 是 Git commit SHA，不能用时间戳或内容 digest 替代。先读取当前 revision，再修改；并发提交通过非强制 Git 引用更新保护，失败不会覆盖另一写入。

同一个变更集内，每项新操作使用新 key；传输失败时以相同 method、path、JSON 字节及 key 重试。成功的保存/上传/审核会把 key 摘要和请求指纹记入 Git；重试返回原操作产物及当前变更状态，不重复建文件。使用同 key 提交不同内容返回 409。创建的 key 与 actor 决定稳定变更集 ID；不要重复使用创建 key。校验不写 Git；发布操作经 PR 合并，本身不会再次创建内容。每个变更集最多 20 篇内容、30 个素材、200 次记录操作。

同一次创建的重试可继续使用原创建 key：已合并分支被删除时，从 main 审计和 merge revision 恢复原 id、批准引用并读取合并/发布状态，不重新建分支。并发首次创建在分支出现后会复用已写入的元数据，不清空另一个请求已保存的编辑；不同内容复用同 key 仍返回 409。

所有响应中的 `revision` 都可用于下一次修改，成功响应也提供带引号的 ETag。首次创建返回 201，保存/上传/审核返回 200，成功请求合并返回 202。错误结构为 `{"error":{"code":"REVISION_CONFLICT","message":"...","details":[]}}`，details 仅在有字段/发布问题时出现，不含凭据。

## 全部端点

| 方法与路径 | 输入与用途 | 主要输出 |
| --- | --- | --- |
| GET `/schema` | 无；获取共用 schema 的 JSON Schema、限制和能力 | `kinds`, `blog`, `landing`, `limits`, `blogComparison:false` |
| GET `/templates/{blog或landing}` | 无；获取实际 CMS 模板，含待替换文本 | `kind`, `data`, `body`；默认草稿，不能直接发布 |
| GET `/entries` | 无；读取 main 内容清单，包括草稿 | `revision`, `entries:[{path,...data}]` |
| GET `/entries/{kind}/{slug}` | main 完整记录 | `revision`, `path`, `data`, `body` |
| POST `/changes` | `{"title":"单行变更说明"}`；最长 180 字符 | `id`, `revision`, `baseRevision`, `state:"draft"`, `digest`, `entries`, `assets`, `pullRequest`, `approval` |
| GET `/changes/{id}` | 当前变更/审核/生产状态 | 上述变更字段，审核后另含 `checks`，合并后含 `mergeRevision` |
| GET `/changes/{id}/entries/{kind}/{slug}` | 在该变更分支读取记录 | `revision`, `path`, `data`, `body` |
| PUT `/changes/{id}/entries/{kind}/{slug}` | `{"data":{完整字段},"body":"正文"}`；完整替换该记录，不是 PATCH | 更新后的变更对象；任何编辑使旧批准失效 |
| POST `/changes/{id}/assets` | `{"name":"photo.png","mime":"image/png","base64":"..."}` | 更新后的变更对象和 `asset:{path,sha256,width,height,bytes,mime}` |
| GET `/changes/{id}/assets/{返回路径的文件名}` | 读取该变更的原始素材字节，含未发布素材 | 正确图片 MIME，私有缓存策略；需要 token |
| POST `/changes/{id}/validate` | `{}`；校验拟发布版本，不改草稿字段 | `publishable`, `issues`, `digest`, `revision` |
| POST `/changes/{id}/review` | `{"digest":"读取到的当前digest","approval":"内容负责人批准这些具体差异的说明，20–2000字符"}` | 更新变更、PR URL、批准审计引用；保留每条记录的 `draft` 值和内容字节 |
| POST `/changes/{id}/publish` | `{}`；在精确批准和必需 CI 成功后请求保护合并 | 202 和当前状态；保护规则、冲突或检查未通过时拒绝 |

首版无删除/URL 重命名接口、任意分支/路径参数、远程 URL 抓图、R2 预签名上传或管理权限接口。一个变更集可以包含多篇内容，但批准覆盖整个变更集的当前 digest。

## 内容字段与安全子集

字段权威是 `/schema` 与 `src/lib/content/entry-schemas.ts`；它也供 Astro 使用，不能另维护一份宽松 API schema。接口拒绝未知字段；完整 PUT 时先 GET 原记录并保留未打算修改的字段。新记录未传 draft 时为 true。`slug` 必须和端点一致，只能小写字母、数字、连字符，最多 100 字符；工具保留路由不允许占用。已发布 URL 不在本接口中重命名。

| Blog 必填 | 说明 |
| --- | --- |
| `slug`, `title`, `description` | URL 标识、页面标题、摘要；不能为空 |
| `publishedAt`, `readTime` | 有效 `YYYY-MM-DD` 日期、阅读时间文字 |
| `body` | Markdown 正文字符串；最多 100000 字符 |

Blog 可选 `seoTitle`, `updatedAt`, `author`, `category`, `featured`, `draft`, `templateVersion:1`。有 `coverImage` 时必须有非空 `coverAlt`。`contentMode` 默认 markdown；选择 html 时用 `bodyHtml`，Markdown body 必须为空。

安全 HTML 仅允许 `p br hr h2 h3 h4 h5 h6 strong em b i u s del blockquote ul ol li a img figure figcaption table thead tbody tfoot tr th td pre code`。允许属性：a 的 href/title；img 的 src/alt/title/width/height/loading；th/td 的 colspan/rowspan；ol 的 start。其他属性、命名空间和元素一律拒绝，不静默改写运营文字；使用浏览器兼容解析器检查实体解码后的 URL。数字属性为 1–9999，loading 仅 lazy/eager。不接受脚本、事件、style、iframe、表单或 SVG。

Markdown 不接受 raw HTML、MDX import/export 或可执行组件。图片支持普通/引用写法且必须有 alt。图片只引用 `/uploads/...` 或 `/images/...` 的公共路径；超链接仅允许 HTTPS、站内绝对路径或锚点，不允许账户凭据、协议相对地址、私有 API、data/javascript URL 或路径穿越。正文中的相对 URL 请先转为站内绝对路径。**Blog 首版没有结构化 Before/After 块或滑柄，只支持静态图片。**

标题、摘要、FAQ 等结构化字段还会进入 JSON-LD，因此所有 data 字符串均拒绝 script 标签界定符和 HTML 注释；不会替运营静默改写文字。需要展示相应代码时应使用 Markdown 中的静态代码块。

| 工具落地页必填 | 说明 |
| --- | --- |
| `slug`, `title`, `description`, `eyebrow`, `heading`, `intro` | 基础 URL/SEO/首屏文字，均不能为空 |
| `benefits` | 至少一条非空文字 |
| `process` | eyebrow/heading/intro，以及恰好三项 steps；每项 number/title/description |
| `faq` | eyebrow/heading/intro，以及至少一项 question/answer |

可选 `toolKind`、`heroSamples`、`features`、`scope`、`relatedTools`、`guides`、`cta` 等的完整字段见 schema 和下方完整示例。toolKind 只选择已有四种落地页类别，不能创建新处理能力或改变扣费。旧内容中的 comparison 预设只能原样保留，不得新增假水印配置。

工具图像只有 image 时静态显示；增加 afterImage 才可能启用共用 ImageDisplay 比较。两张图必须是运营提供的真实 Before/After 独立文件、宽高比一致，并由内容负责人确认同构构图；自动尺寸校验无法证明内容真实。不得通过生成水印、合成前图或使用图内烘焙滑柄冒充可交互比较。原有图片路径/文件名/字节/alt 不会因本接口部署被改动。

完整且可解析的请求示例：[`blog.json`](examples/content-api/blog.json)、[`landing.json`](examples/content-api/landing.json)。示例只在文档目录，不会生成 SEO 页面；它们引用现有公共图片，也可将相应字段替换为本变更集实际上传返回的 path。模板中的待替换文字与占位图必须完成后才能申请发布。

## 素材规则

只接受静态单帧 JPEG、PNG、WebP。文件名是小写 ASCII 单词/数字与连字符，加 jpg/jpeg/png/webp 扩展名，最多 100 字符；不带目录。MIME、魔数、扩展名必须一致，且必须能完整解码。每张非空、最多 **2000000 字节**，每边 **1–6000 像素**、总计不超过 **24000000 像素**；动画、SVG、GIF、损坏数据和超限像素拒绝。JSON 请求最多 **3000000 字节**，包含 base64 膨胀，低于 Vercel 的平台上限；更大素材请由运营先准备合适版本，不转走用户私有上传接口。

存储路径为 `/uploads/content-api/{id}/{名称}-{字节SHA256前16位}.{规范扩展名}`。API 原样保存图片字节，不重编码；同名不同内容得到新版本，同名同字节复用同一路径，不覆盖旧文件。jpeg 的输出扩展名规范为 jpg。新素材在草稿分支中持久存在，可用带鉴权的素材 GET 预览；**返回 public path 不表示该 URL 已上线**。必须把该 path 填进同一变更集的内容后一起发布。

不自动删除未引用或历史版本，不设置定时清理。取消变更时由维护者关闭其 PR/分支；已发布素材必须检查所有引用后走独立审核 PR 删除，不能改动其他变更或用户 R2。Git 中含已公开图片，不应上传个人私密素材。

## 审核、独立基线与状态

保存不批准内容。内容负责人先读取分支记录、下载素材、检查差异和事实，再读取 digest 并提交明确批准说明。review 会把 digest、具体路径和图片哈希、actor、源 revision 记入 PR 评论；只为这些已批准的既有保护记录同步独立基线，fixture 差异和内容在同一 PR 中供审阅。新建草稿不重写全站基线，研发验收不批准原有 SEO 内容修改。继续保留独立 `seo-content-ownership` 测试。

审核与合并保留明确的 `draft` 值。要公开真实运营内容，先完整 PUT 将获授权的记录设为 `draft:false`，再读取新 digest 审核。`draft:true` 也可经过受保护 PR、CI 和合并发布到 Site，但保持无公开页面、无 sitemap 收录。响应的 `entryVisibility:[{path,draft}]` 表示逐条可见性；验收草稿必须始终为 true。

任何后续编辑使批准失效。publish 再检查批准评论、素材真实哈希、基线只能包含本次批准差异、PR 只含本变更允许路径，以及相同 head 上 GitHub Actions app 15368 的 `verify` 与 `Required target artifacts` 成功。调用 GitHub PR merge 时固定 head，不直接写 main、不 force、不关闭保护。GitHub 仍可因分支落后、待解决讨论等拒绝合并；不能用 API 绕过。

| state | 含义与下一步 |
| --- | --- |
| `draft` | 仅草稿分支；编辑、上传和校验 |
| `approved` | review 请求完成，精确内容已批准且 PR 已准备审核 |
| `in-review` | PR 存在，需完成当前批准 |
| `awaiting-ci-or-merge` | 批准已记录；检查 checks，必需 CI 成功后请求 publish |
| `closed` | PR 已关闭未合并，保留证据，另起变更集 |
| `merged-awaiting-deployment` | 已合并，但没有核实到公共 Site 的对应发布证明 |
| `published` | PR 已合并且公共 `/content-publications.json` 含本次 id/digest，证明 Site 产物已包含本次批准 |

`published` 表示 Site 已包含该批准版本，条目的公开与否仍由 `entryVisibility` 中的 draft 决定；不能据此声称草稿页面已公开，也不是编辑事实/SEO效果或图片真实性的保证。仍需检查所有改动页面和素材 URL 的真实 HTTP，以及公开内容代表模板桌面/移动显示。Site 证明只公开 id/digest，不公开审批说明、身份或 Token。Git 分支被维护者在合并后删除时，状态通过 main 审计和 merge revision 恢复读取。

若 GitHub 已合并的 REST 响应未提供有效合并提交号，服务端读取同仓库、同 PR 的官方 [GraphQL `mergeCommit.oid`](https://docs.github.com/en/graphql/reference/pulls#pullrequest)。GraphQL 未提供有效合并号时返回 503 `MERGE_REVISION_UNAVAILABLE`（仓库请求不可用仍为 `GITHUB_UNAVAILABLE`），保留原变更供重试；不把当前 main 推断为历史合并版本，不重建分支。

## Node 完整调用示例

以下保存为本机忽略目录的脚本，用 Node 22/24 执行。Token 从受保护文件读取，不放进参数或打印。示例创建**未发布草稿**，上传图片、引用、校验并保留恢复信息；不会自动批准示例内容。

```js
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
const token = (await readFile('.secrets/content-api-token.txt', 'utf8')).trim();
const root = 'https://www.watermarkgemini.com/api/content/v1';
const recordFile = 'output/content-draft-recovery.json';
const image = await readFile('authorized-image.png');
const documentSource = await readFile('docs/examples/content-api/blog.json', 'utf8');
const inputSha = createHash('sha256').update(image).update(documentSource).digest('hex');
await mkdir('output', { recursive: true });
let journal;
try { journal = JSON.parse(await readFile(recordFile, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw new Error('Recovery record is invalid; preserve it for review.'); }
journal ??= { version: 1, origin: root, inputSha, run: randomUUID(), requests: {}, responses: {} };
if (journal.version !== 1 || journal.origin !== root || journal.inputSha !== inputSha) {
  throw new Error('Recovery record belongs to different input or origin; use a new record.');
}
async function saveJournal() {
  await writeFile(recordFile + '.tmp', JSON.stringify(journal, null, 2), { mode: 0o600 });
  await rename(recordFile + '.tmp', recordFile);
}
await saveJournal(); // Output, target and original keys are durable before the first write.
const run = journal.run;
async function api(path, method = 'GET', data, revision, key = randomUUID()) {
  if (data !== undefined) {
    const descriptor = { path, method, digest: createHash('sha256').update(JSON.stringify(data)).digest('hex') };
    const previous = journal.requests[key];
    if (previous && (previous.path !== path || previous.method !== method || previous.digest !== descriptor.digest)) {
      throw new Error('This operation key belongs to different content; review before using a new key.');
    }
    if (journal.responses[key]) return journal.responses[key];
    if (previous) revision = previous.revision;
    else journal.requests[key] = { ...descriptor, revision };
    await saveJournal(); // Preserve the original revision even if the response becomes UNKNOWN.
  }
  const response = await fetch(root + path, {
    method, redirect: 'error',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(data === undefined ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': key }),
      ...(revision ? { 'If-Match': `"${revision}"` } : {}),
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${result.error.code}`);
  if (data !== undefined) { journal.responses[key] = result; await saveJournal(); }
  return result;
}
const schema = await api('/schema');
if (!schema.kinds.includes('blog')) throw new Error('Blog unavailable');
let change = await api('/changes', 'POST', { title: 'Editorial draft review' }, undefined, `${run}-create`);
change = await api(`/changes/${change.id}/assets`, 'POST', {
  name: 'editorial-photo.png', mime: 'image/png', base64: image.toString('base64'),
}, change.revision, `${run}-asset`);
const assetPath = change.asset.path;
const document = JSON.parse(documentSource);
document.data.slug = `editorial-draft-${run.slice(0, 8)}`;
document.data.coverImage = assetPath;
document.data.coverAlt = 'Accurate description supplied by the content owner';
document.body = `## Editorial draft\n\n![Accurate source image description](${assetPath})\n`;
change = await api(`/changes/${change.id}/entries/blog/${document.data.slug}`,
  'PUT', document, change.revision, `${run}-save`);
const validation = await api(`/changes/${change.id}/validate`, 'POST', {}, change.revision, `${run}-validate`);
journal.last = { change, validation }; await saveJournal();
console.log({ id: change.id, revision: change.revision, publishable: validation.publishable });
```

操作真实运营内容时，完成事实、素材和差异审阅后，继续调用：

```js
change = await api(`/changes/${change.id}`);
// 仅对获授权的真实运营稿，先完整 PUT {...document,data:{...document.data,draft:false}}，
// 并采用新的稳定 key；保留原草稿时无需此步。重新读取 change 获取新 digest。
// 仅当内容负责人确已审阅这些具体差异后执行；文档示例不得转为公开内容。
change = await api(`/changes/${change.id}/review`, 'POST', {
  digest: change.digest,
  approval: '内容负责人已审阅本次具体正文、SEO字段、素材与alt差异，并批准此digest对应版本。',
}, change.revision, `${run}-review`);
// 到返回的 PR 中核对内容与基线 diff。等待必需 CI；不循环触发新的构建。
const status = await api(`/changes/${change.id}`);
// checks 全部满足且内容审阅完成后，使用最新 revision 请求保护合并。
const released = await api(`/changes/${change.id}/publish`, 'POST', {}, status.revision, `${run}-publish`);
console.log({ state: released.state, pullRequest: released.pullRequest });
// 后续 GET /changes/{id} 查看 merged-awaiting-deployment / published。
```

现有内容更新：先 GET `/entries/{kind}/{slug}`，读取完整 data/body；创建变更集后仅修改获授权字段，完整 PUT 到相同 kind/slug，再走校验与精确审核。不要把创建模板覆盖到既有内容上。工具页使用完整 landing.json 结构，同样 PUT 到 `/entries/landing/{slug}`。

示例必须沿用同一恢复文件重跑，不能每次换 run/key。创建成功就保存了 id/revision；后续上传/写正文的每次请求前也保留原 key、payload 摘要和 revision，响应丢失时以同一请求恢复 UNKNOWN。更换 origin、图片或原始文档时拒绝复用旧记录；新内容需要新的恢复文件和明确的新操作键。恢复记录不保存 Token、签名 URL 或图片字节，不要同时用多个进程修改同一记录。

## 错误与失败恢复

| HTTP / code | 处理 |
| --- | --- |
| 400 `INVALID_JSON` / `IDEMPOTENCY_REQUIRED` | 修正 JSON 或补 key；不要输出 Token 调试 |
| 401 `UNAUTHORIZED` | 核对安全交付的 token、轮换状态；不是 Google 登录问题 |
| 404 `NOT_FOUND` | 核对 kind、slug、变更 ID；端点不接受任意路径 |
| 409 `REVISION_CONFLICT` | GET 最新变更和内容，人工合并具体差异后用新 key/新 revision 保存 |
| 409 `IDEMPOTENCY_CONFLICT` | 同 key 换了操作或 JSON；真正新操作使用新 key |
| 409 `REVIEW_DIGEST_CONFLICT` / `APPROVAL_REQUIRED` | 重新读取、审阅当前差异并明确批准；不伪造审核引用 |
| 409 `CI_PENDING_OR_FAILED` / `MERGE_BLOCKED` | 查 PR 真实失败；修正后重新审核变化，等待必需 CI；不绕过保护 |
| 409 `SCOPE_VIOLATION` / `BASELINE_SCOPE_VIOLATION` / `ASSET_CHANGED` | 停止发布，维护者核对分支是否被其他写入修改 |
| 409 `SLUG_EXISTS` / `CHANGE_CLOSED` / `INVALID_CHANGE` | 换新 slug/变更集或交维护者检查；不覆盖、强推或重开旧发布 |
| 413 `ASSET_TOO_LARGE` / `REQUEST_TOO_LARGE` | 在运营侧准备满足限制的素材，不能用私有媒体接口绕过 |
| 415 `JSON_REQUIRED` / `ASSET_TYPE` | 修正请求类型、MIME、扩展名和真实图片字节 |
| 422 `SCHEMA_INVALID` / `UNKNOWN_FIELD` / `UNSAFE_CONTENT` / `INVALID_BODY` / `INVALID_DATE` | 根据 details、schema 和安全子集修正内容 |
| 422 `ASSET_NAME` / `ASSET_ENCODING` / `ASSET_DIMENSIONS` / `ASSET_DECODE` | 修正文件名、base64、尺寸/动画或损坏文件 |
| 422 `NOT_PUBLISHABLE` / `CHANGE_LIMIT` / `INVALID_SLUG` / `RESERVED_SLUG` / `IMMUTABLE_SLUG` / `INVALID_TITLE` | 完成发布要求，或分为新变更；不能改现有 URL |
| 428 `REVISION_REQUIRED` | 先 GET revision，按带引号格式提供 If-Match |
| 503 `NOT_CONFIGURED` / `REPOSITORY_NOT_CONFIGURED` / `REPOSITORY_UNAVAILABLE` 等 | 检查专用凭据、授权范围、到期和平台状态；相同 key 重试，不重建内容 |
| 503 `CHECKS_UNAVAILABLE` | 公开 Checks 异常、限流或仓库不再公开；等待/交维护者处理，绝不当作 CI 通过，也不安装宽权限 token 绕过 |

审核在 Git 提交/PR 准备就绪中断时，分支和审计保留；同 key 重试恢复，或由维护者在 GitHub 把 PR 标记 Ready。合并因 main 前进而失败时，维护者在 PR 更新分支并检查冲突；如果无法保证原批准差异，重新基于最新 main 建变更集并迁移明确选择的内容/素材，旧分支保留供恢复。网络超时不能据此认定“没有写入”，先 GET 变更，再以原 key 重试。

## 实际验收命令

```sh
node scripts/content-api-smoke.mjs --token-file .secrets/content-api-token.txt --out output/content-api-read-smoke.json
node scripts/content-api-smoke.mjs --token-file .secrets/content-api-token.txt --write-draft --image public/uploads/background-remover-product-photo.png --out output/content-api-draft-smoke.json
```

第二条创建隔离未发布草稿和原字节素材，核对跨请求持久读取与下载哈希；不调用 review/publish、不发真实文章、不触发 Provider 或处理扣费。真实 PR/CI/部署链另按发布证据核验：可仅批准保持 `draft:true` 的隔离条目，等待受保护 CI 后合并，核对公共 manifest 和素材原字节，并确认草稿 URL 404、sitemap 无收录。不能把单独的草稿检查或 Mock 当作真实保护发布通过。

写验收会在首个远程请求前准备并检查恢复文件；`--out` 未传时默认 `output/content-api-draft-smoke.json`。创建成功立即记 id/revision，各阶段保存进度，失败时原 key 与 pending 请求保留。断网/上传失败后以**相同 origin、image 和 --out** 重跑，复用原草稿而非另建；输出目录不可写则不会先创建 Git 分支。不要删除恢复记录“重跑”来掩盖 UNKNOWN；更换输入或目标需新记录，并保留原分支供人工恢复/清理。
