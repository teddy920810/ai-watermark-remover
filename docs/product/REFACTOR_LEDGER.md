# AI Watermark 本地重构与验收台账

更新：2026-11-01。唯一当前阶段台账；方案历史保存在[归档快照](../history/REFACTOR_PLAN_2026-10-31.md)。P0–P7及内容回退阶段为本地交付；用户于2026-11-01（Asia/Shanghai）在主任务明确“目标是上线，去安排吧”，已核实原始用户消息，目标扩大为研发收尾、受保护PR/CI/main、Site/App/Worker部署与匹配生产验收。既有内容原值和预算继续保护；不自动充值，不开启/扩大正式收款，不删除金融依据或未恢复任务。

当前：P0–P7本地机制及内容回退已验收；现推进main发布候选。素材原值保持，运营整改独立登记。敏感恢复数据擦除、Blog独立发布分类与受保护CMS草稿流程已在候选实现，正在结清最终门禁、CI和真实环境证据，尚未上线。以下43项为阶段记录，实时发布进度见文末。

## 版本与唯一执行位置

- 当前维护目录：D:/ermei/ai-watermark-remove。origin：https://github.com/teddy920810/ai-watermark-remover.git。
- 基线 HEAD：574ad43e53e5696e225f7fa73606e3849d7bd2db；本地分支：codex/refactor-local-20261031。所有本轮实现尚未提交，阶段版本由独立 manifest、文件 SHA-256 和二进制 patch 识别。
- 产品源码、配置和仓库脚本保持跨平台；D 盘是本机维护登记，不是产品运行依赖。本轮在Windows主机验证，未冒称macOS/Linux实机验收。其他聊天的源码工作目录没有被覆盖、删除或归档。
- 原始D盘103个文件已逐一保全，原HEAD为5be42381；恢复stash为410512fce71bab1a8fc2554e893c6ffaea5a4de1。按[原件清单](../../output/refactor-plan-2026-10-31/p0-preservation/manifest.json)选择性恢复，不将旧Pricing/支付草稿整体回灌当前实现。凭据不在这些源码工作包中。

## 43项状态

| 项 | 已接受工作范围 | 当前状态及边界 |
| --- | --- | --- |
| P0.1 | 登记所有关联工作树、分支、HEAD、归属、未合并内容和必需证据；确认当前任务执行上下文指向 D。 | 本地完成 |
| P0.2 | 为 D 当前56项受控修改、22项未跟踪记录建立本地可恢复工作包，核对文件和字节；凭据保留在本机忽略配置，不进入 Git/报告。 | 本地完成 |
| P0.3 | 对78项逐项分类：已被 main 等价包含、main 已有更新实现、独有待续内容、需确认冲突。D 中旧 Pricing/支付草稿不能直接覆盖当前线上实现。 | 本地完成 |
| P0.4 | 将当前远端基线安全归并至 D。独有未采纳内容保存在明确的待续工作包；本轮重构分支不混入无关修改。保持可恢复。 | 本地完成 |
| P0.5 | 将需要的 C 盘验收资料转入 D 并核对，修正报告入口；具备条件且属于本任务的工作树使用 Git/Codex 可恢复归档，其他任务工作树先核对归属，不直接删文件夹。 | 本地完成 |
| P0.6 | 后续仅在 D 根目录切换专用阶段分支；本地预览明确从 D 启动，记录版本。核对依赖和工具版本，不复制 C 的构建产物当生产产物。 | 本地完成 |
| P1.1 | 建立唯一操作目录，覆盖当前六类产品功能及旧协议映射，明确输入/输出、费率来源、三类权益、执行器和恢复规则。 | 本地完成 |
| P1.2 | 明确公开内容、公开 Pricing、私有 App、API、静态资源的路由分类；将构建目标归属与 private/noindex 判断拆开。 | 本地完成 |
| P1.3 | 修复支付组件只被判为 Site 的发布分类缺口；测试/文档不无差别触发全部生产目标，required CI继续保留。 | 本地完成 |
| P1.4 | 统一 CMS 的保留路径/合法内部链接规则，允许已知 `/pricing`、App 入口，保留草稿/未知SEO路径限制。 | 本地完成 |
| P1.5 | 修正 Worker audience、根域/www跳转、公共/真实功能 smoke、CI/Vercel责任等确定错误；建立当前规范总索引。 | 本地完成 |
| P1.6 | 固化本计划第7节的长期维护规则：唯一目录预检、变更影响说明、规范同步责任、关键合同检查、受控合并/发布和交付收尾；检查按迁移阶段逐步启用。 | 本地规范/预检/模板完成；GitHub/CMS外部强制门禁 pending |
| P2.1 | 以当前main目录为基准建立 `src/pages/pricing.astro`，公开 `/pricing` 展示套餐、图片费率、权益适用范围和购买说明；匿名可见且首屏有真实目录。D盘同名旧草稿先经P0核对，不直接启用。 | 本地完成 |
| P2.2 | 从当前组件提取纯展示部分；`/app/credits` 专注所选套餐确认、付款、订单和恢复，移除公开营销价格页职责。 | 本地完成 |
| P2.3 | 将精确 `/pricing` 设为 App 构建拥有的公开SSR路由，公开SEO代理不吞掉它；Site不导入支付服务端代码。 | 本地完成 |
| P2.4 | 全站导航与价格入口指向 `/pricing`；选择套餐进入 `/app/credits?sku=...&returnTo=...`。服务端仍按SKU和目录版本确定金额。 | 本地完成 |
| P2.5 | 保持旧 `/app/credits`、订单锚点、Google回跳、同源安全returnTo、账户隔离和activeAttempt优先规则。 | 本地完成 |
| P2.6 | 更新 canonical、sitemap、CMS保留slug、缓存/索引与对应测试；未知SEO URL继续真实404。 | 本地完成 |
| P3.1 | 抽取基础设计变量和最小按钮/状态样式，拆清 Site、App和编辑器样式所有者。 | 本地完成 |
| P3.2 | 建立一套图片组件和比较控制器，覆盖0/1/2张、加载失败和切换示例；新组件不支持临时水印叠层。未迁模块暂保留旧渲染适配，逐组迁移素材与调用，P5完成后删除旧分支。 | 本地完成 |
| P3.3 | 同步内容schema、CMS双图字段、渲染和操作说明；新录入只使用单/双图规则，旧记录读取保留迁移兼容。运营只配内容/素材，不自行选择上传接口或滑块实现。 | 本地完成 |
| P3.4 | 共享弹窗登录生命周期、媒体识别/草稿交接、画布小型基础函数；保留各操作政策差异。 | 本地完成 |
| P3.5 | 清点所有在用图片为单图、真双图、含假控件待替换三类，形成素材迁移清单。 | 本地完成 |
| P4.1 | 建立明确 AppShell 与操作模块，先整理草稿、账户、准备、报价、处理、恢复、结果的状态表，再拆 Workspace 编排。 | 本地完成 |
| P4.2 | 将背景和物体编辑能力迁入 App；本阶段先通过适配复用现有旧API，不同时改供应商协议和金融执行协议。 | 本地完成 |
| P4.3 | 保留 Standard、PRO、精修、视频、背景、物体六类能力：透明/颜色导出、画笔/套索、版本、视频固定区域及真实输出不丢失。 | 本地完成 |
| P4.4 | 统一 `/app` 产品入口与媒体/操作推荐；原 `/app/image`、`/app/video` 深链继续定位同一产品，兼容草稿和已存在任务。 | 本地完成 |
| P4.5 | 增加无私有数据的静态加载壳和可理解的加载/失败反馈，避免整页React尚未就绪时没有入口说明。 | 本地完成 |
| P5.1 | 首页、全部公开工具页、正文/页尾CTA、App再次选文件接同一文件接入逻辑。 | 本地完成 |
| P5.2 | 按钮统一 Upload file，删除营销页Image/Video预选切换及重复上传按钮组；类型由文件决定，操作推荐由来源决定。 | 本地完成 |
| P5.3 | 图片/MP4按当前真实能力接入；不兼容推荐或未开放操作由App明确提示并提供可用功能，不静默误处理。 | 本地完成 |
| P5.4 | 首页、工具首屏、案例、功能图使用统一单/双图模型，清理各页独立比较实现；素材由运营/SEO拥有。 | 机制本地完成；P5擅自替图已撤销，52个烘焙控件候选和1个缺失图待运营，不记整改完成 |
| P5.5 | 保持各页独立内容及图片路径/alt/示例说明；CMS不覆盖公共产品交互。 | 2026-11-01按原基线恢复27个内容文件；独立内容基线与最终HTML检查，内容更改须明确授权 |
| P6.A.1 | 抽取接受调用方事务client的免费账户/权益原语，整理重复余额读与恢复候选查询。 | 本地完成 |
| P6.A.2 | 按Web/Worker实际需求组装Provider facet、连接池与资源关闭责任，保留现有Provider接口和第三方请求合同。 | 本地完成 |
| P6.B.1 | 逐操作将背景/物体从旧协议迁到耐久处理链；同步公开/内部operation、capability、报价、mask/metadata、输出投影及Worker适配。 | 本地实施及验收完成；真实 Provider/生产迁移 pending |
| P6.B.2 | 保留原操作费率、三类余额、透明输出、对象归属、reserve/outbox、未知状态与退款/迟到结果规则。 | 本地实施及验收完成；真实 Provider/生产迁移 pending |
| P6.B.3 | 先迁客户端与新准入；旧接口查询、下载和已接受任务继续工作，观测并确认退出窗口后才停旧准入。 | 新客户端准入完成；旧API继续兼容，关闭准入等待真实验收与退出窗口 |
| P7.1 | 依据运行引用/旧客户端/在途任务/结果与会话窗口，逐项退役旧Uploader、旧API准入与确无消费者的局部抽象。 | 无当前入口的UI/抽象已退役；旧API及在途/金融记录保留 |
| P7.2 | 按代表页面和状态覆盖清理闲置CSS；统一公共资源代际、来源、hash与退出条件，不按“当前源码未引用”直接删历史资源。 | 样式清理、本地门禁及资源代际/退出条件登记完成；历史资源保留 |
| P7.3 | 原MVP PRD归档；当前规范、ADR、发布记录、历史验收、可执行模板分类并建立唯一索引。 | 本地文档归档/唯一索引与台账完成 |
| P7.4 | 正式重构台账落入 `docs/product/`，标出每阶段实现版本、证据和遗留项；本计划草稿只保留指向正式台账的入口。 | 本地文档归档/唯一索引与台账完成 |
| P7.5 | 完成剩余工作树的归属核对与可恢复归档，确认全项目实际维护已归D；保留必要历史材料。 | 10目录归属/状态已核对；当前聊天无可归档附件，其他聊天归档 pending |

## 当前产品合同

六类新操作共用 App 与耐久上传/报价/确认/恢复流程。Standard、PRO、精修的JPEG、背景透明/本地纯色PNG、物体原尺寸PNG及二值选区、视频MP4/时长/音轨各自保持；三类余额不合并。匿名文件留本地，登录后准备和报价，明确处理点击后才创建任务。UNKNOWN、旧报价、幂等、归属、CAS/lease/outbox、退款和迟到结果仍按原请求恢复。

公开内容使用一个 Upload file 入口和 ImageDisplay 单/双图规则。CMS只编辑内容、素材、排序和已知推荐；价格、能力、Provider、按钮动作与凭据由代码/服务端拥有。公开 /pricing 仍由App SSR提供真实目录，结算与付款恢复留在 /app/credits。当前规范见[索引](../INDEX.md)、[架构](../CURRENT_ARCHITECTURE.md)、[工作区](APP_WORKSPACE.md)、[图片操作](IMAGE_OPERATIONS.md)和[文件入口](FILE_INTAKE.md)。

## 可审阅工作包

工作包和截图保留在本机忽略目录；这里的链接是证据入口，不把历史构建产物或凭据加入Git。各包记录相对上一阶段的文件字节和hash，P7还记录删除项与恢复来源。

| 阶段 | 独立实现/恢复包 | 主要门禁记录 |
| --- | --- | --- |
| P0 | [原件](../../output/refactor-plan-2026-10-31/p0-preservation/manifest.json) / [逐项处置](../../output/refactor-plan-2026-10-31/P0_DISPOSITION.md) | [基线](../../output/refactor-plan-2026-10-31/p0-preservation/baseline-verification.json) |
| P1 | [工作包](../../output/refactor-plan-2026-10-31/p1-implementation/manifest.json) | [首次完整检查](../../output/refactor-plan-2026-10-31/p1-release-verify-first.log)及下文补验 |
| P2 | [工作包](../../output/refactor-plan-2026-10-31/p2-implementation/manifest.json) | [分项](../../output/refactor-plan-2026-10-31/p2-gate-results.json) |
| P3 | [基础包](../../output/refactor-plan-2026-10-31/p3-implementation/manifest.json) / [收尾包](../../output/refactor-plan-2026-10-31/p3-completion/manifest.json) | [分项](../../output/refactor-plan-2026-10-31/p3-gate-results.json) |
| P4 | [工作包](../../output/refactor-plan-2026-10-31/p4-implementation/manifest.json) | [分项](../../output/refactor-plan-2026-10-31/p4-gate-results.json) |
| P5 | [工作包](../../output/refactor-plan-2026-10-31/p5-implementation/manifest.json) | [分项](../../output/refactor-plan-2026-10-31/p5-gate-results.json) |
| P6 | [后端A](../../output/refactor-plan-2026-10-31/p6-a-implementation/manifest.json) / [背景](../../output/refactor-plan-2026-10-31/p6-background-implementation/manifest.json) / [物体](../../output/refactor-plan-2026-10-31/p6-object-implementation/manifest.json) | [完整分项及首失败/补验来源](../../output/refactor-plan-2026-10-31/p6-gate-results.json) |
| P7 | [原件与静态入边](../../output/refactor-plan-2026-10-31/p7-retirement/manifest.json) / [清理范围](../../output/refactor-plan-2026-10-31/p7-retirement/cleanup.json) / [最终工作包](../../output/refactor-plan-2026-10-31/p7-implementation/manifest.json) | [本地分项](../../output/refactor-plan-2026-10-31/p7-gate-results.json) |

## 门禁分别结清

| 门禁 | 当前证据/状态 |
| --- | --- |
| P6本地代码 | 154文件、1202测试通过，9项外部集成显式skip；覆盖率lines91.56%、branches82.94%、functions86.59%、statements84.79%。Lint、379文件类型0error/6既有hints、Site40页/App/Worker实际产物通过。锁/依赖未变，复用P1 audit。 |
| P6浏览器 | 133个唯一用例通过；独立图片3项通过。旧容器断言与真实双图懒加载死锁的首失败、定向红绿和修复后Site实际产物分别保留。 |
| P7本地代码/场景 | 退役/CMS/样式44项绿；物体/背景/精修与竖图4项绿；UI检查首轮两项旧选择器断言修正为当前MediaLauncher所有者，11项定向绿，check:ui最终144项单元与31项浏览器绿。Lint、364文件类型0error/6既有hints、最终Site40页/App实际产物均通过。Worker源码未改，复用P6已过产物。 |
| 仓库/PR | local-only，未提交、推送、创建PR或合并；本地通过不能替代未来required CI。 |
| 部署 | 未执行。Site、App与Worker必须在未来发布时分别核对预期SHA/产物，不能用本地构建替代。 |
| DNS/证书 | 本轮未改域名、DNS或证书，not applicable。 |
| OAuth与真实处理 | 尚未以真实用户会话、PG并发、生产Web/Worker配置和实际Provider完成本轮验收；未来按受影响操作和明确预算逐项核实，不记为通过。 |
| Production Smoke | 本轮无生产环境/域名改动，未执行public smoke；未来部署后的匹配认证功能smoke仍pending，尤其新背景与物体必须各自一次，不循环收费重试。 |

## 保留项与退出条件

- P1.6：本地AGENTS、预检、PR模板、合同和规范已落地。P1只读快照显示main保护未启用、Protect规则disabled，CMS/模板仍存在main直写；这是2026-10-31的回读证据，不能当后续时刻的现状。外部强制设置未获本轮修改授权，仍需在后续发布前核实并处理。
- 旧 /api/jobs、上传、查询、下载、Provider与金融/身份/attempt/receipt记录继续保留。当前客户端迁入v1不证明旧客户端、在途任务、结果和会话窗口已结束；不停止旧准入，也不重写旧账本。
- 已发布资源的来源与逐项hash以[App retained清单](../../apps/app/retained-assets.json)为权威；公共图片原始分类见[素材清单](CONTENT_MEDIA_MIGRATION.json)，P5替换映射已全部撤销，原内容语义由独立基线验证。P7只移除当前无消费者的源代码/CSS，不删除保留的哈希资产或原始图片；构建仍校验retained资产。退出条件统一见[兼容清单](../COMPATIBILITY.md)。
- 过期session/旧诊断遮罩清理已在发布候选实现，见[合同](SENSITIVE_RETENTION.md)，默认dry-run，云端计划与擦除仍须单列。新owner六真实PG连接首次奖励已验证；其他PG场景、Linux候选产物、OAuth及六类Provider分别结清。现有production-smoke workflow的收费选项仅旧背景操作，新v1入口见processing-acceptance脚本。
- [工作目录复核](../../output/refactor-plan-2026-10-31/p7-worktree-inventory.json)共10目录，其中9个属于其他聊天，3个有未提交内容。当前chat artifacts为空；保留P0恢复包，未绕过应用归属限制归档或删除。全项目其他聊天归档仍pending，不能宣称已清理全部历史目录。

## P7清理与恢复说明

静态扫描确认9个候选模块没有集合外的运行导入，16个源文件/专属测试逐一hash保全后删除；API和Provider服务端实现保持。清理287个已无当前消费者的选择器，App颜色和物体控制仅保留自己的作用域；通用营销卡片仍保留。物体竖图的旧高度限制会让图像与二值mask的坐标比例不同，已由红测确认并移除。CMS删去无消费者的组件定义与CTA按钮/链接字段，merge和存量数据/schema兼容保留，App不再序列化旧控件文案。原MVP PRD逐字节归档，旧路径保留指针。

恢复退役源文件使用[保全清单](../../output/refactor-plan-2026-10-31/p7-retirement/manifest.json)及其files-before，改动前的编辑文件在同目录edits-before。恢复旧UI不会授权新建付费任务、回滚金融记录或关闭新的已接受任务；先按原任务/报价/操作键核对。

## 分阶段证据与首失败记录

### P0 — 本地完成（2026-10-31）

- 原始78项展开为103个文件、13,693,422字节，原件逐一SHA-256复核；[逐项处置](../../output/refactor-plan-2026-10-31/P0_DISPOSITION.md)、[恢复manifest](../../output/refactor-plan-2026-10-31/p0-preservation/manifest.json)。未归类0。原件和二进制patch留本机忽略目录，不进入Git；本机凭据未复制、未输出。
- 使用本地Git stash `410512fce71bab1a8fc2554e893c6ffaea5a4de1`保存原始受控与未跟踪工作，未创建交付commit；原始HEAD `5be42381`。恢复时先另作安全副本，按manifest重放文件，不将旧支付/迁移草稿覆盖当前实现。
- D盘main安全快进到`574ad43`，切换`codex/refactor-local-20261031`；Git tree与origin/main完全一致后，仅恢复用户最新AGENTS独有16行。[基线证明](../../output/refactor-plan-2026-10-31/p0-preservation/baseline-verification.json)。旧Pricing、SQL、支付、首页蒙层全部留待续包；P2从新main拆分。
- 核对10个关联工作树、分支、HEAD、独有提交与聊天归属；3个脏历史框架工作树另复制可读原件和patch，未改其源码。其余工作树属于其他聊天，本任务附件为空，因此没有调用归档，也没有删除文件夹。[登记](../../output/refactor-plan-2026-10-31/p0-preservation/worktree-inventory.json)。所有历史树归档留P7，不阻塞D盘实施。
- 工具落地页工作树178份证据已转入D、613,034,612字节逐一校验。[转移清单](../../output/refactor-plan-2026-10-31/evidence-transfer.json)。原始路径作为证据来源保留，当前报告入口统一指向D。构建zip只是历史证据，未作为本次产物。
- npm ci完成（750包）；首安装使用系统Node22.14并提示engine和旧目录EPERM清理警告，退出0，未掩盖。后续预览/测试明确使用满足engines的Node24.19.0，npm10.9.2，不改系统安装或项目依赖版本。
- 停止原D预览，从D根目录重启`http://127.0.0.1:4386/`；HTTP200且初始HTML有main和文件入口。[预览证明](../../output/refactor-plan-2026-10-31/p0-preview-verification.json)。当前版本574ad43＋AGENTS。仅mock预览，不发真实上传/付款/Provider。
- 门禁：源码tree、原始字节、凭据路径、Markdown/diff和预览来源核对；仅路径/基线归一，不重复main产品全量测试。Git/PR=本地未发布；部署、域名、OAuth与生产smoke=not applicable。
- 下一步P1：先对支付目标归属、测试文件分类与CMS路由增加红测，再修改最小规则；本阶段选一次release:verify。长期目录预检与规范同步按P1.6落地。

### P1 — 本地依赖验收完成；外部门禁pending（2026-10-31）

- 实现：唯一六类操作目录及旧协议映射；能力/类型/限制由目录投影，不改原费率、三类余额、输出和恢复。路由目标与私有/索引分类拆开，CMS共享保留slug和真实App入口。支付组件按真实消费者选择Site/App；测试/文档不触发生产target，required CI仍保留。Site显式拒绝支付服务端模块。
- 维护：跨平台`project:check`读取已有本机登记/显式环境路径，错误目录/origin或未分类文件阻断变更；只读盘点可继续。AGENTS、PR影响说明、规范索引、当前架构及兼容退出清单已落地。32个已审阅改动路径见[p1-classified](../../output/refactor-plan-2026-10-31/p1-classified.json)，独立工作包见[p1-implementation](../../output/refactor-plan-2026-10-31/p1-implementation/manifest.json)。
- 文档：纠正Worker HTTPS subject audience与STS资源名区别（仅文档，原初始化代码未动）；根域跳www；公共/旧操作/v1功能smoke；CI与Vercel职责；风险门禁、内容删除、输出/报价模板、历史列表、生命周期、retained清单权威和历史PRD索引。新文档30个本地链接通过。
- 红绿：[首轮红测](../../output/refactor-plan-2026-10-31/p1-red.log)锁定分类/CMS缺口；[96项绿测](../../output/refactor-plan-2026-10-31/p1-green-initial.log)；[预检红](../../output/refactor-plan-2026-10-31/p1-preflight-red.log)/[绿](../../output/refactor-plan-2026-10-31/p1-preflight-green.log)；真实消费者补充[红](../../output/refactor-plan-2026-10-31/p1-consumer-red.log)/[绿](../../output/refactor-plan-2026-10-31/p1-consumer-green.log)；私有支付目录边界[红](../../output/refactor-plan-2026-10-31/p1-private-catalog-red.log)/[绿](../../output/refactor-plan-2026-10-31/p1-private-catalog-green.log)。没有放宽断言。
- 唯一门禁release:verify采用分段补验：首次audit无high/critical（19 moderate、1 low按原依赖记录），site validation通过，140文件/1121测试通过、9项外部集成显式skip，覆盖率达标。Lint首失败为新增脚本缺Node导入；补验构建发现该脚本默认空数组被推为never[]，补明类型。两个失败均保留，未重复audit/全覆盖率/图片优化。最终Lint、Astro零error、Build、响应式资源校验通过。[首日志](../../output/refactor-plan-2026-10-31/p1-release-verify-first.log)、[补验1](../../output/refactor-plan-2026-10-31/p1-release-verify-resume.log)、[补验2](../../output/refactor-plan-2026-10-31/p1-release-verify-resume2.log)。
- E2E首轮104 passed/5 failed/1 skipped；并发时本机可用内存曾低于1GB，未改产品代码/测试断言。保留[全部首失败trace](../../output/refactor-plan-2026-10-31/p1-e2e-first-failure/)，安全核查端口/进程后只用1 worker复验失败5项，全部通过（42.7s）。[单并发补验](../../output/refactor-plan-2026-10-31/p1-e2e-single-worker-retry.log)。合计109项通过，1项dummy enabled-SSR opt-in未运行，不能记为通过。
- 外部只读核实：main protection API为404 Branch not protected；rulesets为200，Protect enforcement=disabled。[原始回读](../../output/refactor-plan-2026-10-31/p1-protection-readback.json)。CMS和模板workflow仍直接写main，Vercel/required CI的外部发布拦截未获修改授权，保持pending；P1.6不整体勾选。CLI gh不可用后使用Git已有凭据仅在内存访问GitHub同仓库只读API，无凭据输出。
- P1.4已完成实际App入口与统一保留路径；公开/pricing尚未存在，避免接受不存在的CMS链接，随P2新增真实路由再补齐，暂不勾选。P1本地产品依赖已经验收，继续P2；外部强制发布门禁不宣称完成，也不阻塞独立本地代码工作。
- 工具：本机验证已统一使用D下忽略的Node24.22.1/npm11.19.1工具副本（仅运行时，非C源码/构建产物），产品与脚本无机器路径依赖。仓库/PR=本地未提交；部署与生产验证未执行，域名/OAuth/真实付款/Provider=not applicable于本阶段本地验收。
- 回退：P1独立文件/patch保全；原始D工作仍在P0恢复包。尚未改变外部设置或生产流量。下一步P2先补公开首屏、目录一致、SKU/returnTo、恢复优先与索引/代理红测。

### P2 — 本地完成（2026-10-31）；未部署/未真实付款

- 公开`/pricing`由现有App SSR提供，沿用getPaymentConfig→publicPaymentCatalog白名单；首屏真实目录、canonical、no-store、可索引。纯CreditCatalog无客户端水合、SDK、订单或鉴权请求。Site仅导航与sitemap，不导入支付私有配置；实际Site/App产物报告已验证精确归属和私有模块隔离。未知Pricing子路径仍404。
- `/app/credits`保留所选套餐确认、登录、支付、Your orders和旧存储key；移除套餐营销卡片/费率职责。入口统一去/pricing，选SKU进入结算，URL金额无效，returnTo同源白名单保持。活跃attempt优先于URL，含下架SKU，原order金额展示；无法确认创建/付款时只能恢复原请求，不新建替代订单。官方付款SDK/按钮回调形状及服务端Create/Capture、身份/金融协议未改；已复核PayPal官方文档。
- [P2增量工作包](../../output/refactor-plan-2026-10-31/p2-implementation/manifest.json)相对P1快照保存；累计50个已分类路径见[p2-classified](../../output/refactor-plan-2026-10-31/p2-classified.json)。docs/PAYPAL_LIVE_RELEASE、当前架构、CMS链接和部署目标说明已同步。P1.4的/pricing真实路由及CMS链接验收随本阶段补齐；P1.6外部保护仍pending。
- 目标红测：[路由/索引/选择红](../../output/refactor-plan-2026-10-31/p2-red.log)、[公开页404红](../../output/refactor-plan-2026-10-31/p2-browser-red.log)、[导航缺口红](../../output/refactor-plan-2026-10-31/p2-navigation-red.log)。定向绿测72项通过。首轮浏览器24 passed/4 failed；修复一个实际恢复回归（隐藏确认区同时藏了错误反馈），费率断言迁到真实公开展示，折叠菜单先打开，标题限定main排除开发工具；[补验5项全绿](../../output/refactor-plan-2026-10-31/p2-browser-corrected.log)。首失败[trace](../../output/refactor-plan-2026-10-31/p2-browser-first-failure/)与[p2-green.log](../../output/refactor-plan-2026-10-31/p2-green.log)均保留；新增纯组件测试使用已有esbuild编译JSX，不改全局测试配置。
- 高风险门禁按P1已确认的本机并发问题采用单并发等价验证；替代重复的combined build，直接验证两个实际Web目标产物，并单独跑全部类型检查。依赖锁/依赖/overrides未变，复用P1 audit；图片模板/媒体未变，复用其响应式栅格校验。全覆盖率142文件/1126 passed、9项外部集成skip，Lint、Astro check零error和Site/App构建通过。新增测试的安全清理检查曾触发no-unsafe-finally，移到finally之前后补验，未重跑已过的覆盖率。[首门禁](../../output/refactor-plan-2026-10-31/p2-release-verify.log)、[补验](../../output/refactor-plan-2026-10-31/p2-release-verify-resume.log)、[分项结果](../../output/refactor-plan-2026-10-31/p2-gate-results.json)。
- 全套浏览器启用dummy Sandbox以覆盖SDK首屏门禁，112 passed/1 failed；失败是旧免费物体用例收到额外consent字段。保持断言，以该用例原本PAYPAL_CREDITS_ENABLED=false补验，1 passed（35.1s）；合计113个唯一用例均通过，包括enabled-SSR的SDK请求前置条件。原始[全套失败](../../output/refactor-plan-2026-10-31/p2-full-browser-first-failure/)和[正确上下文补验](../../output/refactor-plan-2026-10-31/p2-legacy-fixture-corrected.log)分开保留。可复现runner已把普通全套与dummy enabled SDK子验收隔离，不再用全局dummy污染旧免费夹具。
- 人工视觉：Playwright独立本地浏览器，只读检查公开Pricing/结算桌面与手机，Blog负向区域。截图在output/playwright/refactor-p2-*；已逐张查看，无横向溢出/遮挡产品控件；底部黑色浮层是仅开发环境的Astro toolbar。截图显示关闭收款的本地Sandbox预览，不能当正式套餐或生产状态证据。[本地HTTP](../../output/refactor-plan-2026-10-31/p2-local-http.json)确认/pricing 200/no-store/无noindex/canonical，/app/credits 200/private no-store/noindex，/pricing/unknown真实404。
- 预览从D启动，`http://127.0.0.1:4386`，版本574ad43＋P1/P2工作包。曾碰到尚在退出的4379测试服务，第一次启动仅报告复用旧服务；待测试结束并核查停止后才在4386启动，两个日志分别保留。浏览器已关闭，预览保留。
- 门禁状态：本地代码/场景passed（含首失败后的定向补验）；Git/PR=local-only未提交；生产App/Site部署、真实OAuth/付款/退款为pending后续授权验收；本阶段未改R2/CORS/Provider/域名，相关真实功能smoke not applicable，不声称生产完成。回退依靠P1/P2独立快照；不重建订单或清空恢复存储。
- 下一步P3：公共图片/比较控制器、CMS可选After与旧记录兼容、样式所有权、小型登录/媒体/画布基础。初步只读盘点134个营销图片位置/72个素材/0个真实独立双图，24处旧示意蒙层；像素审阅索引与3张缩略图表已保存，尚未改素材或把P3.5标为全部完成。

### P3 — 本地完成（2026-10-31）；P5素材替换仍待实施

- 公共基础：design-system.css拥有tokens、base、按钮、导航/账户与登录原语；Site营销/暂存旧编辑样式留原所有者，App/Pricing直接导入公共基础。原视觉断言改读真实样式所有者，不削弱颜色/布局要求。
- ImageDisplay与唯一新控制器覆盖0/1/2图、双源成功且比例一致才比较、单侧失败静态降级、双侧失败提示、键盘0/50/100、捕获拖动、触控、取消和切例50%复位。无临时水印API。固定frame明确fit=cover，两侧裁切一致；默认保留原图比例。两图比例一致不能证明同构图，运营必须核对。
- CMS/schema：图片1＋可选图片2，空After可清除；新记录不注入合成水印默认值。首页/工具新单双图消费者已接入，旧comparison/illustration逐组兼容到P5，旧字段不再出现在新表单；merge=true保留旧记录。CMS未获得能力/费率/Provider配置权。[规范](./IMAGE_DISPLAY.md)。
- 共享auth-completion保留Window同源、BroadcastChannel、权威getSession、并发去重、重试和清理；旧编辑器仍只恢复明确同意的价格，Workspace仍仅准备/报价后等待点击。官方signIn初始化形状未改。坐标/二值mask小函数保留物体clamp与alpha>10、精修非clamp与alpha>0、全opaque输出；画笔/套索/历史政策不合并。已有媒体识别和IndexedDB草稿继续共享，未新增另一套。
- 素材全清单：已发布内容＋源码literal共237引用、166独立素材，7张contact sheet逐张审阅；0真实独立双图，52项烘焙比较线/控件待P5替换，1项原缺失资源待替换，其余静态。包含Blog、头像、share和placeholder，草稿/运行时用户媒体不在范围；源码literal可能保守包含未激活项。[正式素材清单](./CONTENT_MEDIA_MIGRATION.json)、[原始盘点](../../output/refactor-plan-2026-10-31/p3-all-public-images.json)。未把烘焙控件当已移除。
- 红绿：原始4类缺口[p3-red](../../output/refactor-plan-2026-10-31/p3-red.log)，CMS和新记录默认值分别有红绿；基础定向81项通过、最终模型/生命周期51项通过，清空After补验45项通过。浏览器fixture配置前几次先暴露Astro7入口/root/后台锁差异，保留原日志，正确fixture后才记行为红测。触控发现native range与自定义指针冲突，改为控件层捕获；未放宽75%断言。[组件最终](../../output/refactor-plan-2026-10-31/p3-cover-components-final.log)2项通过，并接入npm verify/CI。
- 唯一高风险门禁等价验证：依赖与锁未变复用P1 audit；site validation通过。全量首轮6失败皆为旧测试仍找原样式/监听位置；更新真实所有者及共同生命周期断言后，146文件/1136测试通过、9外部集成skip，覆盖率lines91.64%、branches82.81%、functions87.09%。Lint、Astro零error（6既有deprecated hints）、combined build、458 responsive衍生和45页markup通过。[首失败](../../output/refactor-plan-2026-10-31/p3-release-verify.log)、[补验](../../output/refactor-plan-2026-10-31/p3-release-verify-resume.log)、[分项](../../output/refactor-plan-2026-10-31/p3-gate-results.json)。
- 页面浏览器112 passed/1 dummy skip，dummy enabled SDK专项1 passed，合计113唯一用例均通过。图片fixture2项另通过，不替代真实处理。手工视觉又发现nested image未填满卡片/工具首屏的灰带，补桌面/手机几何红测后最小修正fit，2项绿；保留首失败trace、灰带截图及修正后截图。最终Site实际产物再构建通过，无支付私有模块；复用已过的后端/账户/支付检查，不为最后这一显示参数重跑全量。
- 视觉：首页（含新单图卡）、工具、App、Blog负向区域均检查桌面/手机；修正后卡片/首屏无新增灰带和溢出。旧图片自身的比较控件/裁切内容继续明确列P5，不宣称全站图片完成。[本地HTTP](../../output/refactor-plan-2026-10-31/p3-local-http.json)关键公开路径200、Pricing no-store可索引、App noindex、未知Pricing404；App原始HTML无H1/静态壳的缺口留P4。mock预览capabilities503显示可理解的重试提示，非真实业务通过证据。
- 工作包：40个P3核心增量[manifest](../../output/refactor-plan-2026-10-31/p3-implementation/manifest.json)＋10个收尾增量[manifest](../../output/refactor-plan-2026-10-31/p3-completion/manifest.json)，累计分类87路径，预检/diff通过。首次后台预览启动30秒超时，排查无端口冲突后前台预览从D启动成功；截图后已关闭浏览器和自有服务，给P4测试让出端口。未提交/推送/PR/部署，真实OAuth/付款/Provider与生产smoke未执行。
- 下一步P4：按已梳理的状态表抽AppShell及操作模块，背景/物体先复用旧API适配；保留六种能力和原恢复/金融语义，再做统一入口，后端协议另在P6迁移。

### P4 — 本地完成（2026-10-31）；真实操作门禁pending

- AppWorkspaceLayout/AppShell拥有共同静态壳、账户呈现、操作选择与分块失败恢复；/app返回200而非重定向，image/video旧深链共用同壳。Standard、PRO、精修、视频保留耐久协调；背景/物体用旧API适配，本阶段没有改后端计费或Provider协议。[状态合同](./APP_WORKSPACE.md)。
- 入口、文件跨操作交接、PRO持久、旧视频任务类型优先、账户切换隔离、模块恢复、首次登录已接受价格与恰好一次提交均有红绿。首次登录isPending曾卸载编辑器造成文件丢失，修正为保留初次登录状态；补上当前草稿owner认领。原首失败保留，不把模拟登录当真实OAuth验收。
- 六类操作级浏览器覆盖包括PNG透明/颜色与真实下载、物体二值mask/原图切换、Standard/PRO实际JPEG、精修版本/重画、视频固定区域/同步MP4及下载；既有三类余额、旧报价、UNKNOWN无付费重试、408恢复、过期报价与坏文件替换规则保持。
- 完整门禁：首次覆盖率运行1项ESLint路径检查5秒超时，其余1143项通过；该项未改代码单独通过，因首轮未产出覆盖率报告，用2 workers补跑，147文件/1144 passed、9外部集成skip。覆盖率lines91.52%、branches82.60%、functions86.78%、statements84.85%。Lint、361文件Astro零error（6既有hints）、Site40页/App实际产物通过。锁和依赖未变复用P1 audit，P4未改营销图片模板复用P3栅格检查。[首次](../../output/refactor-plan-2026-10-31/p4-release-verify.log)、[覆盖率补验](../../output/refactor-plan-2026-10-31/p4-coverage-bounded-retry.log)、[分段](../../output/refactor-plan-2026-10-31/p4-gate-results.json)。
- 全套浏览器122 passed/1 failed/1 opt-in skip；唯一失败为重画坐标落在Astro开发浮层，trace确认坐标704,707被遮挡。每次绘画滚动画布并重取box后，原两份mask必须不同及只提交第二报价断言通过；未放宽费用或mask断言。dummy enabled-SDK专项1 passed，合计124唯一用例通过；图片fixture另2 passed。[全套](../../output/refactor-plan-2026-10-31/p4-release-verify-resume.log)、[首失败](../../output/refactor-plan-2026-10-31/p4-refinement-first-failure/)、[重画补验](../../output/refactor-plan-2026-10-31/p4-refinement-redraw-targeted-retry.log)、[最终专项](../../output/refactor-plan-2026-10-31/p4-release-verify-final-segments.log)。
- 人工视觉覆盖图片/视频空态、背景准备/结果/透明与白色选中、物体画笔、Blog负向区的桌面/手机，均无横向溢出。发现颜色控件三条样式未迁入App，先补浏览器红测，再补原样式及旧登录G标记样式；绿测确认padding/控件高度、白色aria-pressed、透明/白色PNG下载。首失败trace在[p4-palette-style-first-failure](../../output/refactor-plan-2026-10-31/p4-palette-style-first-failure/)，[绿](../../output/refactor-plan-2026-10-31/p4-palette-style-green.log)。最后CSS增量仅补App产物构建与相关浏览器/视觉，复用已过后端/支付/全覆盖率。[最终App](../../output/refactor-plan-2026-10-31/p4-app-artifact-final-ui.log)。截图output/playwright/refactor-p4-*，调色板是完全拦截的本地假结果，只证明UI布局，不证明AI抠图。
- [本地HTTP](../../output/refactor-plan-2026-10-31/p4-local-http.json)确认App兼容入口200/noindex/静态说明，Pricing200/no-store可索引，结算private/no-store/noindex，Blog200，未知Pricing404。原始HTML的H1 token计数含Astro惰性fallback template；实际DOM一个main H1由浏览器验收，不混为双标题。
- [P4增量工作包](../../output/refactor-plan-2026-10-31/p4-implementation/manifest.json)独立保存，最终预检无未分类路径，diff无空白错误。手工预览最初与构建重叠尚未监听，未当功能失败；停止自有服务后在4386重开成功。最后截图隐藏开发浮层且快进CSS过渡，仅影响本地截屏。已关闭浏览器及自有预览。
- Git/PR=local-only未提交；没有推送/部署、云配置、真实OAuth/付款/Provider调用。真实处理/认证功能验收仍pending，不能把P4称生产迁移完成；相关服务端/金融协议留P6。P1.6外部保护仍pending。

### P5 — 本地完成（2026-10-31）；未部署/真实操作pending

- 已完成首轮实现：首页＋20个公开工具页、正文上传CTA及页尾共用MediaLauncher，固定Upload file、不预选媒体；App选取/拖入复用识别/草稿基础。来源只作推荐，不兼容或未开放时明确提示；已接受任务优先。App替换保留原金融与Provider接口。
- 红绿：初始4类合同红与2个浏览器红已保留。统一入口浏览器4 passed，包含全部21个主入口、Footer、媒体错配/Coming Soon与App换类型；匿名真实上传与收费0。原controller消费者测试18项旧断言失败已记录，将比较手势验收留在唯一真实ImageDisplay控制器，并同步新的内容/入口所有权；47文件326项定向绿，原图片字节hash检查和标题/正文/FAQ/SEO检查保留。
- 素材：复核7张contact sheet，53项引用迁至已存在的完整静态素材，27条内容记录的保护投影未变（标题、正文、步骤、FAQ、SEO、URL）；仅配图/alt与首页示例说明调整。无图片字节编辑、无假造Before、原素材删除0。P3分类保留、P5 resolution记录来源hash，见docs/product/CONTENT_MEDIA_MIGRATION.json与p5-content-migration-results.json。
- 补验真实发现两处回归：迟到的替换文件识别会在任务开始后跳到视频App，补mounted/busy守卫后同一原任务保持且只提交一次；App购Credits链接丢operation query，补保留当前query/hash，旧公开returnTo不变。首失败分别保存在p5-replacement-race-first-failure与p5-purchase-return-first-failure。背景/物体最大费用、价格变动、登录原consent、402恢复及PNG/mask输出10项App专项全通过；App drop/并发补验2通过。
- CMS：三个旧uploader交互fieldset已移除，全局merge=true保留已存兼容字段；CMS只供内容/素材/原工具类型及状态推荐，能力/Provider/真实费率仍在代码与服务端。23项CMS/素材合同通过。类型365文件0error/6既有hints、Lint通过，后续仅文档和测试selector调整需要补相应检查。
- 当前边界仍为D盘本地，未提交/推送/部署、未改云配置、未真实付款或调用付费Provider。P5完整风险门禁和桌面/手机实图尚未完成，未勾选阶段条目；P4工作包可回退。下一步完成代表模板/旧操作兼容验收，再跑一次最小充分release等价门禁（实际Site/App产物＋新HTML响应式检查），不为最后文案/selector重复已充分覆盖的检查。

- P5补验进度：正文/受众CTA已统一原生文件选择；移动工具主入口首屏顺序红绿通过；同页公开能力说明请求由6次收敛为一次带超时请求，余额/价格/任务不缓存。功能图26px灰带由旧max-height约束引起，先保留真实失败再修正cover规则；桌面/手机逐张复核通过。33个本地HTTP路径通过。全量首次3条旧消费者/CMS断言失败（其余1146通过、9skip）；已按真实所有者同步并24项定向通过，覆盖率报告未产出故补跑覆盖率，其他未执行分段顺序继续。尚未记阶段完成。

- P5门禁续报：148个测试文件通过、1个外部集成文件skip；1149 passed/9 skipped，lines91.28%、branches82.33%、functions86.35%、statements84.53%。Lint、365文件类型检查零error、Site40页与App实际产物、42份HTML响应式标记均通过。130项页面浏览器仍在运行。已核查自有进程，无额外手工预览；本机可用内存曾约180MB，未终止其他聊天/MCP进程。

- P5收尾：全套页面126 passed/3 failed/1 opt-in skip，首失败trace保存在p5-browser-first-failure。两项仍找旧站点Account menu，同步为App实际Sign out，取消consent后真实任务数仍要求0；缺失图片已按P5迁移修复，改为先确认真实素材加载，再主动拦截原图/衍生资源并要求占位图加载成功。修正专项2通过；背景专项补验在进入编辑器前发生5秒冷加载超时（截图只有Opening workspace），未更改断言，待资源恢复后同项1通过（28.6s），两轮trace分别留存。
- P5最终：129个普通唯一用例＋dummy enabled SDK 1＝130唯一页面用例通过；图片组件2另通过。覆盖率1149 passed/9外部集成skip；Lint、365文件类型检查0error/6既有hints、Site/App实际产物、42 HTML响应式栅格与公开Pricing/私有模块边界均通过。最后仅测试selector/网络故障夹具调整补定向Lint，不重跑已过的产品全覆盖率/构建。分段结果p5-gate-results.json保留首次结果和补验组合，不能读取为首轮全绿。
- P5视觉：已逐张查看首页主入口/功能图/单图案例/受众正文CTA/Footer、背景与Gemini代表模板、App图片/背景空态和Terms负向区的桌面/手机；无横向溢出，主入口可用。截图output/playwright/refactor-p5-*。33个本地HTTP路径通过，非生产验收。预检首轮漏分类tool-landing.css移动顺序样式，按已审阅范围补显式登记，最终无issues；diff空白检查通过。
- P5独立工作包见[p5-implementation](../../output/refactor-plan-2026-10-31/p5-implementation/manifest.json)，保留所有原图片，当前D盘分支HEAD仍574ad43＋本地改动。Git/PR=local-only未提交；Site/App/Worker生产部署、真实OAuth/Provider、认证功能smoke pending后续授权验收，域名/DNS/CORS未变。P1.6外部保护仍pending。下一步P6.A先做事务client免费权益原语、同次余额读取和恢复候选去重，再按真实Web/Worker消费者收敛资源与Provider facet。

### P6.A — 本地依赖检查点完成；P6完整门禁待B收尾

- A1：调用方事务client的ensureFreeBenefitAccount同时写首奖励/账本；Benefit显式触及活动/规范化身份，Processing只初始化。原BEGIN/COMMIT/锁顺序不动；同次summary购买余额含0直接复用，下次调用重新读取；账户恢复候选传入JobService，不再第二次查询，仍按owner/20条/lease/settlement校验，不调用Provider重跑。p6-a1-red.log四类红，7文件84项定向绿。
- A2：Web账户与Processing共用原max3/超时的进程池，跨数据库复用拒绝；Worker自有资源与注入/共享资源分开，close恰好一次，pool关闭失败仍销毁自有S3。耐久执行只在runJob构建对应facet，不再构建无消费者的legacy Provider/R2；旧JobService每操作惰性构建并复用。九项p6-a2-red后7文件87绿；后加关闭异常验证，包含在419项检查点。Vendor请求源码未改，旧端点/header/predict_mode/timeout断言移到实际JobService消费路径；官方 https://dewatermark.ai/api-document 已只读复核。
- 源消费者：services.ts实际上仅App，新增红绿将其从保守全目标缩为App；共享事务/运行时资源仍App＋Worker。接口与Provider canonical类型不改。Payment/Better Auth独立资源和初始化保持。后端规范与当前索引已同步。
- 检查点：36测试文件/419 passed，变更文件Lint通过；类型首失败为vi.fn测试替身零参数推断，补明确factory类型后370文件0error/6既有hints；App与Worker实际产物通过。日志p6-a-checkpoint.log、p6-a-checkpoint-resume.log和p6-a-checkpoint-results.json，首失败另存。无UI改动，不重复P5营销视觉。此为A依赖检查点，P6的唯一完整release等价门禁将在逐操作B迁移后执行，未标P6全部完成。
- A工作包p6-a-implementation/manifest.json与独立patch保全。下一步先背景，再物体，均沿现有协调器；旧API在途任务/查询/下载继续兼容，真实Provider与生产迁移门禁仍pending，未调用真实收费服务。

### P6.B 背景 — 本地依赖检查点完成；P6完整门禁另计

- 已先做operation/金融/PNG合同红测、Provider恢复红测及操作级浏览器红测，再迁入v1/Worker和共同WatermarkWorkspace。背景仅免费一次或配置图片费率，无管理员Credits回退；价格版本、旧报价和已接受幂等保留。旧API准入/查询/下载未改。
- 共享原Replicate配置值给Web/Worker；背景能力/演示状态按自己的Provider决定。私有checkpoint固定mock/replicate身份，已接受预测只GET原prediction，网络结果未知不POST重发；同步结果先保全再写租约checkpoint。透明PNG、原尺寸与owner/private namespace核对，原Request body/headers/endpoint形状有回归锁。初步后端6文件71 passed，含配置切换后的mock/real在途恢复；真实调用均被测试transport拦截。
- 新背景UI只沿共同协调器处理；保留原颜色列表、自定义颜色、透明/纯色PNG及真正下载。登录后准备/报价并等明确处理点击，不把尚未报价的登录当处理授权。六项背景浏览器均通过（实际PNG全像素/尺寸、原图/结果、调色控件padding、价格变更需二次点击、UNKNOWN、登录、购买returnTo、自动过期预览恢复）；当前组合9 passed/1失败为旧Object竞态夹具迁移时Sharp参数名误替换，正在只补该项。
- 已捕获真实UI缺口：UNKNOWN时替换按钮仍可点，统一输入/按钮/方法锁后单项通过；背景Core购买链接原硬编码丢operation，抽复用BuyCreditsLink的returnTo规则后红绿；过期结果预览沿原job只GET一次自动恢复，无新任务。所有首失败trace/log保留。
- 旧BG UI测试转到新真实消费者并保留所有原PNG像素/样式/无新收费断言；旧协议consent仍由Object活跃适配器及JobService/金融单元覆盖。背景的类型、受影响模块检查点、实际产物与桌面/手机视觉尚待结清，物体迁移还未开始，P6完整门禁/生产Provider仍pending。

- 背景本地依赖检查点结清：65文件/543 passed；Lint首轮仅旧测试删除后留下unused uploadKey，移除该测试常量后通过；377文件类型0error/6既有hints，App/Worker实际产物通过。随后将新增预测/结果receipt置于现有受保护provider-attempts子树，新增红绿锁路径，67项恢复/生命周期补验与最终两目标构建通过；没有改实际R2规则。
- 浏览器补验10 passed，涵盖背景实际PNG/透明与全像素白色下载、颜色控件样式、物体旧consent/mask/402及共同精修桌面手机负向。背景6项＋共同入口/旧适配的先前9项和Object竞态单项补验也通过；首失败分别保留，其中Sharp参数误替换是测试夹具修正。四张背景结果/控件及精修桌面/手机截图已逐张查看，无溢出/遮挡；全透明图是合成PNG夹具，只验证UI与导出，未冒充AI效果。
- 来源与费用规范、当前架构、App工作区、兼容边界已同步。预检无未分类路径，默认Git换行配置的diff检查通过；一次临时禁用autocrlf的检查把CR误判为行尾空白，该日志保留但不据此改写文件。背景独立包将写p6-background-implementation/manifest.json。后续物体迁移单独进行；P6完整release等价门禁、匹配新操作的smoke脚本与真实认证/Provider验收仍待整体收尾，不将本检查点当生产完成。

### P6.B 物体 — 实现与定向检查完成，完整门禁进行中（2026-11-01）

- 物体迁入v1/Worker，保留旧operation ID与旧API准入/查询/下载。免费一次优先，其次独立配置图片费率，不回退管理员额度；选区必须是当前source归属的sealed PNG，同尺寸、非空、opaque二值。原报价、幂等、退款/UNKNOWN/CAS/lease/outbox不变。
- 扩展同一Replicate耐久适配器，保留Lama固定版本、URL参数形状、headers与image/mask对象；归一化原图和threshold128 mask留在现有私有inputs/masks目录，预测/results receipt仍在受保护provider-attempts子树。只恢复原预测，不POST重发；lost lease先保全收费结果，物体PNG不重编码。官方模型与HTTP文档再次只读复核；未调用真实Provider。
- App六类新操作共用协调器。ObjectMaskEditor单独保留brush/lasso/eraser、20份历史、clamp与alpha>10二值策略，不混入精修政策；本地source到签名source不清空当前选区。重画/撤销使旧报价失效，只提交最新mask。原尺寸实际mask/PNG、免费和购买余额隔离、原图/结果、恢复、UNKNOWN锁、价格变化、登录后等待明确处理点击均已覆盖。
- 发现小图画布只按自然像素显示，新增几何红测后修正为填满编辑宽度；保留首失败。恢复背景/物体粘贴，经红绿沿共同识别/原图保留/锁规则。新耐久功能smoke支持两操作、必需物体mask、PNG/透明/原尺寸与三余额恰好一次变化；24项模拟测试通过，未运行收费smoke。下载签名保留背景/物体原PNG文件名，9项投影测试绿。
- 后端定向首次65文件565 passed/1旧合同失败（仍断言物体v1不合法）；修正为六类目录与旧watermark别名边界后单项2 passed。新金融14、Replicate14、组装/金融/Provider77专项绿。浏览器当前消费者33项首轮32 passed/1旧input label失败；修正实际Core消费者，并明确非收费准备与任务提交边界，完整门禁包含其补验。所有首失败trace/log独立保留。
- P6唯一完整release等价门禁的前段已完成：154文件1202 passed、9外部集成skip；覆盖率lines91.56%、branches82.94%、functions86.59%、statements84.79%；全Lint、379文件类型0error/6既有hints、Site40页/App/Worker实际产物和响应式HTML检查通过。依赖/锁不变复用P1 audit。全套133项浏览器及dummy-enabled SDK/图片组件后续段仍在运行，尚未宣布P6完整通过。
- 已查看桌面/手机物体实际选区截图和此前背景/精修负向；此为合成媒体与模拟身份/transport，不能当真实AI效果、OAuth、PG并发或生产迁移验收。Git/PR仍local-only未提交，无部署或云更改。P7当前只做引用/工作树只读盘点：10目录，其中3个其他目录脏；当前chat artifacts为空，未归档/删除任何其他目录。

- P6本地完整门禁结清：主浏览器131 passed/1旧容器断言失败/1 opt-in skip；失败单项改读当前Core容器、原图与再次选文件后通过，dummy-enabled SDK另1 passed，合计133唯一用例通过。首失败trace保留。图片组件首次1 passed/1失败发现真实加载顺序缺口；新增唯一URL的cold-Before/After先加载红测稳定复现，再仅使双图Before也eager。组件最终3 passed，保留原0/1/2、键盘/拖动/触控/取消/重置/fit与移动断言。单图懒加载未改。最后Site实际产物重新构建和变更测试Lint通过，不重跑已过后端覆盖率/支付/Worker。完整分项与补验provenance见p6-gate-results.json。
- P6.A与两操作的本地实施/验收已结清，物体独立工作包p6-object-implementation/manifest.json；真实OAuth、PG并发、Web/Worker生产配置、逐操作收费Provider和production smoke仍pending。旧API准入退出条件未满足，继续保留，不能将本地通过写成生产迁移完成。下一步P7只清理已证明确无当前运行入口的界面/抽象和对应闲置样式、归档文档及正式台账；不删除历史API、金融/Provider记录、保留资源或其他聊天目录。


### P7 — 可自主推进的本地工作已收尾（2026-11-01）

退役目标、原件/hash、当前导入边界与CSS逐项记录在P7清理包。44项定向检查、4项操作/竖图/精修检查、check:ui的144项单元与31项浏览器，以及Lint、类型、Site/App实际产物通过。首轮两项旧样式选择器断言已转到当前MediaLauncher所有者，首失败和11项定向补验分别保留。

首页/条款桌面与手机、当前背景/物体与精修负向截图已查看；无横向溢出或控件遮挡。第一次人工截图尚在水合准备态，补明确等待控件可用后再截图，原HTTP记录保留。6个本地URL状态符合预期，0写请求；UI能力/身份为本地模拟，HTTP为实际只读请求，未冒充生产或AI效果。图片与竖图坐标修复均有独立红绿。

文档、决策背景/ADR、历史发布/验收、可执行模板和唯一索引已同步，原MVP原文逐字节归档。原output草稿现在只保留本台账入口；34份变更中的现行Markdown链接检查无意外缺失，最终工作包生成后还会检查其证据链接。未提交、推送、创建PR、合并、部署或修改云设置，未执行真实收费操作。外部保护、真实认证/Provider验收、旧API/资源窗口与其他聊天的归档继续按上表保留pending，不能将43项一概勾成生产完成。

最终本地视觉/HTTP记录见[检查记录](../../output/refactor-plan-2026-10-31/p7-final-visual-http.json)，阶段分类和工作区状态见[预检](../../output/refactor-plan-2026-10-31/p7-preflight-final.json)。

### 内容越界回退与上线差距梳理（2026-11-01）

用户明确图片命名、路径、alt与内容归运营/SEO所有。研发此前P5替图与改alt越界，本次撤销53条替换映射，按574ad43逐字段恢复27个内容文件；保留公开Pricing导航、Upload file、App、单/双图机制及后台恢复合同。回退前与P1–P7最后快照逐文件hash一致，没有覆盖后续用户内容改动；原始D盘旧稿仍保全，不回灌旧版本。

独立原基线红测28项失败、双图alt浏览器红测1项失败后，恢复内容并修正兼容读图优先级和alt自动后缀。定向38项绿；旧Gemini测试中两条替图断言改为原图与最终渲染选择，首失败保留。最终一次完整内容门禁44文件345项通过，类型364文件0error/0warning/6既有hints、构建和46份HTML响应图检查通过；图片组件4项浏览器通过，变更代码Lint通过。不叠加重复后台/支付全量检查。

构建产物本地HTTP/HTML检查28个公开URL、236处图片src/alt匹配，原缺图保留占位fallback；原图烘焙控件保留为静态像素，无代码合成滑柄。首页/Gemini/条款1440与390宽六份截图已查看，无横向溢出。此处是静态公开产物检查，静态服务器不提供auth/capabilities API（404），未据此声称身份或处理链通过；观察到的非GET请求为既有GA页面浏览遥测，无业务创建/上传/收费请求。原public资产相对基线无重命名、字节改动或删除。

本轮证据：[摘要](../../output/seo-content-rollback-2026-11-01/summary.json)、[最终HTML/视觉](../../output/seo-content-rollback-2026-11-01/browser-check.json)、[前置审计](../../output/seo-content-rollback-2026-11-01/audit.json)、[独立回退工作包](../../output/seo-content-rollback-2026-11-01/manifest.json)。AGENTS、PR影响模板及独立内容守卫已落地；运营52个烘焙候选/1个缺图仍pending。未提交、推送、PR、合并、部署或修改云设置，未执行真实Provider/支付。

### main发布候选收尾（2026-11-01，进行中）

已核实主任务用户原话“目标是上线，去安排吧”。基线及远端main仍为574ad43，沿用D盘专用重构分支；回退前211项及新阶段原件保存在[发布准备包](../../output/refactor-release-2026-11-01/before.json)，P0、P1–P7与SEO回退证据不覆盖。

- 过期敏感字段擦除已有合同、只读计划/显式digest、关联组/执行终态/财务/到期缓冲/租约/条件写及部分中断续行测试。Worker新增retention模式，不自动调度；实际私有R2dry-run与安全apply待候选和部署门禁。
- 修复独立Blog Markdown未选择Site的分类回归；新增稳定Required target artifacts汇总门禁，selected artifact失败/取消不能放行。main保护已应用并回读200：strict required verify及所选产物汇总、enforce admins、PR、会话结清、禁止强推/删除；单维护者审批数0，不能绕过CI。CMS草稿PR所需仓库权限已应用204并回读，默认workflow权限仍read，代码不自动批准审查。
- CMS模板改为内容分支和Draft PR，不直写main；正常编辑、内容授权、独立基线同步审阅与CI流程已有文档和测试。原内容fixture未改。当前GitHub为单维护者可执行流程，不要求作者批准自己的PR；必需PR/CI不豁免。
- 新owner使用6个真实Sandbox PG连接验证首次权益/账本恰好一次；完整10项真实PG并发通过，当前套件schema已移除。[完整结果](../../output/refactor-release-2026-11-01/postgres-full.log)。首轮外层240秒未等完整套件完成，保留日志；之后只读检查再按足够时限复核，未把首轮当通过。
- 本地release:verify首轮：1243项单元通过、10外部skip，覆盖率statements84.65/branches82.68/functions86.55/lines91.30，Lint、类型/Build及响应图检查通过。E2E首轮128通过、1skip、5失败；其中一条旧替图断言改为保留原缺图fallback，并继续验证真实图片网络失败；其余等待超时保留trace。一次降低并发的5项定向补验通过，图片组件4项通过；未重复已覆盖的后台与构建。新增预算工具定向测试32项通过，后续CI仍对固定候选完整验证。
- 原验收账本在既有工作树的本机忽略目录，原image10/video4共14条保留。用户先说“图片验收给我10credits”，再明确“按10处理Credits核算”；原账本追加本轮最多5次图片调用和累计10个processingCredits双重上限，总调用上限image15/video5，视频不新增。当前新窗口尚未调用、未扣费，未增发账户权益。[授权证明](../../output/refactor-release-2026-11-01/budget-authorization.json)。
- 已核对现有App生产574ad43、Worker image digest与同项目身份；正式PAYPAL_ENABLED=false保持。原Worker未绑定Replicate，已在同项目准备原Provider密钥的独立Secret版本1，仅授予既有Worker SA读取此Secret；待镜像、CI通过后将绑定与真实模式一起更新。Worker当前镜像与环境尚未切换。Vercel连接工具404由已验证本机CLI回读补证，未误判项目不存在。旧Worker在新背景/物体任务已准入后不可作为直接回退目标，应保留兼容新合同的Worker。
- 原测试会话已失效（只读get-session返回匿名）；不伪造登录或账户额度。新版部署后的真实OAuth及余额核对需要原测试账号重新登录，再执行既定预算内的单次功能验收。
- 冻结前额外复核擦除来源：缺失精修parent、跨归属媒体key或仍有效的显式job窗口必须整组保护，已有独立红绿。当前源代码全量1247项通过、10外部skip；覆盖率statements84.66/branches82.73/functions86.57/lines91.32，完整Lint及Build/46份响应图HTML通过，类型0error/0warning/6既有hints。首轮ESLint边界测试5秒冷启动超时已保留，一次限制单元并发后通过；不把超时计作功能断言通过。UI未变，沿用133个唯一E2E及4个组件绿测。[最终代码门禁](../../output/refactor-release-2026-11-01/final-code-gates.json)。

仓库PR/CI、Linux实际产物、三目标部署、真实OAuth、逐操作Provider/产物/余额及生产smoke仍待结清。图片原值、原费用、金融与UNKNOWN恢复、旧API和历史资源继续保护；无关其他聊天目录不构成产品发布阻塞。

### 固定候选与独立审查补修（2026-11-01）

- 候选83a4bc582014d4a0b01ade4cac6fd693c40052fa已推送并建立[PR #98](https://github.com/teddy920810/ai-watermark-remover/pull/98)。原27个内容记录的提交态语义校验通过，public资产无改动；MVP原件与归档Git blob均为61c900777dc64cd9c0d17669fa8fd2e03994e790。14个CMS文件仅Git换行/状态缓存差异，git diff HEAD无内容差异。
- 该候选Linux完整CI及Site/App/Worker独立产物均成功。PR合并预览211e0f5f586d3e7a605810c4f38181f3c689924c与候选tree一致。Worker ZIP digest为2234434e17a90d349608fd64f2006e1ad91f39c1a409765d8c1e6170ad444f64，严格七文件上下文经Cloud Build fe6982eb-da1e-4e61-b3d6-e5e6b12c3374构建成功，镜像digest aec7597aac8f1854a54680e8437a4dfbf973973e33bf71e6a139aea51a22eda8；尚未切换生产。
- 自动独立审查发现：同尺寸不同历史物体任务切换时，旧笔迹/撤销记录残留。新增真实canvas红测复现，再仅使显式历史任务切换推进媒体revision；签名URL刷新不推进revision。15项共同入口/物体登录/报价/余额/手机及新选区用例通过。后续UI门禁与新head CI单列，不据旧head通过直接合并。
- 用户已在专用浏览器完成真实Google登录，get-session与生产账户读取有效。三类余额原均0；用户随后直接授权“你直接补足”。使用既有管理员账本工具先dry-run再为该唯一账号发放7个processingCredits（图片5、现有3.018秒视频2）及2次freeUses（背景/物体各1），原已购图片Credits保持0。审计reference为acceptance-20261101-refactor-six-ops与acceptance-20261101-refactor-images；回读为7/2/0，未启用购买。此授权取代先前“不发放账户额度”的本轮准备边界，图片10处理Credits预算、5次新图片槽和1次剩余视频槽仍不变。
- 最新部署/功能验收状态与不可公开凭据分开保存在忽略目录output/refactor-release-2026-11-01；实际完成前不宣称上线验收结清。

- 947a851的完整Linux CI及三目标产物均成功；七个Worker上下文文件与已部署镜像来源逐文件SHA256一致，不重复构建相同Worker。生产Job generation7已就绪，除固定镜像、两项Replicate模式和新Secret绑定外，完整spec对比一致。
- 生产retention预演ttwln成功：13任务、7满足条件任务/6关联组、6保留。按同一计划digest执行qbkr2成功擦除35条记录；只读后验g7gxs为13任务仍在、0待擦除记录/组。不删除媒体或金融控制记录，不启用清理调度；真实执行日志均在发布证据目录。
- 切换前真实公开资源盘点发现当前574ad43的3个样式/脚本不在旧清单，最终产物也未包含其中的_kind_.D2i4fH02.css。保留清单改以当前生产固定origin46fogy5z8为来源；此前21项哈希逐一不变，补入3个当前页面及其模块依赖，合计24项，仍只允许公开静态字节。独立红测后9项保留测试通过；不改变任何旧脚本内容或支付初始化。实际App打包与新head必需CI另行结清。
- 该App保留清单的实际本地打包已通过。Site从现有sitemap逐页读取39个生产页面并递归核对模块导入，13个当前公开哈希资源共443742字节需要跨版本保留；共用原有有界、逐字节校验逻辑，Site仅允许现有公开固定alias与_site-assets命名空间，保持独立部署URL的保护。3项红测后43项定向绿测；此处涉及构建脚本，因此重新执行完整发布门禁，不以之前head的CI替代。
