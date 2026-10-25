# 图片、视频去水印实施与验收 TODO

## T10 · 2026-10-25 交互精简

交付目标：合并 main、部署上线与生产验收。设计及证据索引见 [交互精简与验收](INTERACTION_SIMPLIFICATION.md)。

- [x] Product Design 审查当前图片、视频流程和费用弹窗。
- [x] 自动上传检查与报价、单次带费用处理、精修及固定选区自动更新。
- [x] TDD 与 18 项工作区浏览器回归：异步竞态、过期、幂等、失败和登录恢复。
- [x] 本地风险门禁采用已记录的等价补验；39 项整站浏览器通过，完成桌面/移动与隐私页负向检查。
- [x] PR #86 合并 main 922ec84；CI 803 项单测、39 项浏览器通过；正式 App/Site READY，11 个旧静态资源字节不变。
- [x] 图片一次、视频一次真实 UI 处理、单次扣额度及实际下载通过；累计图片 9/9、视频 4/5。

本轮分配 3 点验收处理额度，图片使用 1 点、视频使用 2 点，余额回到 0；没有重复收费请求。具体发布标识、验收范围及本机覆盖率超时的限制见 [交互精简与验收](INTERACTION_SIMPLIFICATION.md)。本轮没有发布 Worker，也没有修改 DNS、OAuth 配置或 R2/CORS 策略。

启动日期：2026-10-24。交付目标：专用分支实施、TDD、本地 release:verify、PR/CI、合并 main、部署与生产验收。

正式仓库：teddy920810/ai-watermark-remover；基线 5be42381e32623186ce06dc3dcc6618bae85ebd5。实施分支 codex/watermark-product-delivery。正式 checkout 的既有 10 项修改留在原处，本次实施使用隔离 worktree。

每项依次完成：目标行为 → 定向红测及失败原因 → 最小实现 → 定向绿测 → 范围验收。未完成或受阻的门禁不能勾选。

## 实施清单

- [x] T0 核实仓库、读取项目指令/README/开发指南、确定 main + 上线交付、建立隔离分支。
- [x] T1 将产品/架构决策、操作 ID、输入/产物/报价/任务契约整理进仓库；建立真实调用预算记录。
- [x] T2 图片自动/PRO/精修及视频上传/提交/查询 Provider 契约，媒体检查与可信结果下载；定向红绿测试。
- [x] T3 私有 R2 任务 CAS、输入封存、非收费 preflight、可变金额准入/账本/outbox、租约/UNKNOWN/对账恢复；定向红绿及故障注入。
- [x] T4 认证后的 v1 上传、报价、创建/查询任务、版本与下载 API，接入独立 Worker；归属与幂等测试。
- [x] T5 图片/视频落地初始状态、轻量选择器、IndexedDB 草稿、工作区/登录/费用确认/对比/精修/视频选区与下载；操作级浏览器测试。
- [x] T6 SEO 静态站、App/API、Worker 与稳定路由的构建/发布分离；CMS/能力/索引同步与旧 URL/旧 API 兼容。
- [x] T7 受控真实 Provider 验收、桌面/移动验收、负向区域、实际输出/音轨/费用/恢复核对；本地 release:verify。
- [x] T8 提交与 PR，CI npm run verify 通过，合并 main，绑定正确 SHA 的生产部署。
- [x] T9 公开 HTTP/域名/认证/各新操作一次真实生产功能烟测、独立发布/资源兼容与回滚检查、交付证据。

## 已授权真实调用预算

图片处理最多 8 次（用户已批准从 5 次增加），视频处理最多 5 个任务；失败、超时或不确定的收费提交也计入预算。图片每次精修与 PRO 分别计一次。视频上传/查询不算新的处理任务，重新提交处理算一次。root 统一执行，其他 agent 不调用真实 Provider。

当前已使用图片 8/8 次，视频 3/5 次。图片包括初始普通/PRO/修正精修成功、首次精修一次400，以及正式站普通/PRO/精修/旧接口各一次成功；视频包括直连自动处理一次、正式站固定选区两次，均下载实际MP4并核对音轨。图片预算已用完，不再发起处理请求；剩余视频次数无需用完。禁止自动循环收费重试。

实际调用编号、输入样本、用途、开始/结束、结果、账单变化和剩余次数保存为本地 output/ 下的脱敏验收记录；密钥、完整签名地址、Cookie 与用户私有媒体不能进入仓库或报告。

## TDD 与验证记录

各项实施后在此记录命令、红测原因、绿测统计与证据文件。所有行为变化必须有目标红测；构建/API/鉴权/Provider/存储改动统一执行一次最终 release:verify，不重复叠加同范围门禁。

| 范围 | 目标红测与最小修正 | 定向绿测 |
| --- | --- | --- |
| Provider / 媒体 | 新契约缺失→四操作适配、JPEG规范化、真实媒体探测、精确可信存储域名；真实400后修正首次精修请求 | SDK29项；Provider18项，含慢读取续租 |
| 数据 / 费用 / 恢复 | 新端口与财务准入缺失→R2 CAS、原子预留/outbox；退款余额已满仍恢复；过期报价/被清理报价仍按原key恢复 | 相邻域/运行时115项；旧免费退款6项 |
| 任务保存与预检 | 慢verify/create/settle跨80秒失租、过期预检永久投递→串行CAS、保存续租、过期终态清队列 | worker/preflight/runtime 51项 |
| API | 无认证/跨origin/伪造归属/重复提交/私有错误泄露均先失败；无长度头的大请求未及时停止→流式32KiB上限 | processing-handler 7项 |
| 管理员额度 | 重复grant payload冲突、撤回缺失→可审计幂等grant/revoke，余额不足不扣减 | 管理CLI与财务相邻24项；真实preview/apply已验证撤回 |
| 真实上传签名 | 真AWS signer离线测试复现空body CRC32→WHEN_REQUIRED，Worker仍验SHA | runtime装配测试绿 |
| 独立构建 | 页面与服务器依赖混合、CMS app保留名缺失→静态SEO/App/Worker产物、独立资源前缀与安全SEO代理 | site/app实际构建、最终代理构建与独立CI均已通过 |
| 浏览器操作 | 匿名文件交接、408保留同key恢复、过期报价/余额0恢复、二值遮罩、精修失败保旧版、视频同步、真实附件下载；SSR未就绪先禁用入口 | 3个spec共11项通过，含背景/物体/签到回归；桌面/手机截图已检查 |
| SEO发布内容 | 视频仍标Coming Soon/Free、首页仍称无视频→同步真实限制、管理员额度与入口 | 2项红测→3文件12项绿；其他未发布工具保留原Coming Soon |
| 原账户恢复 | 真实会话原余额503，唯一邮箱与新随机ID冲突→稳定Google subject映射及旧verified Gmail会话兼容 | 52项绿，含真实已安装SDK冷启动；007已应用，真实个人账号原余额2恢复 |

数据库005、006、007已在授权项目执行。GCP已配置独立服务身份、短期联邦、四项最小Secret和镜像仓库，Worker及分钟级恢复调度已真实执行成功；最终代码镜像与Vercel发布已完成，绑定和验收见下方门禁表。正式域名/DNS与已有登录Secret保留。无需新增DNS记录，SEO使用核实后的Vercel固定生产域名；自定义content子域留待以后配置。

用户明确授权后的R2生命周期已单次写入并回读核实：processing/staging、inputs、masks、results创建一天到期；原全桶multipart七天清理规则保留；jobs/quotes/attempts等恢复与费用记录未加此TTL。R2物理删除由后台执行，通常可能另延后约24小时。当前新Provider不再存储无用的base64衍生遮罩；session仍为私有恢复数据。

## 发布门禁

| 门禁 | 状态 | 证据 |
| --- | --- | --- |
| 代码与本地验证 | passed | 最终794单测及覆盖率、类型/Lint/Build、Worker构建通过；本机浏览器28项加2项原断言单并发补验通过；CI完整30项通过 |
| PR / required CI / main | passed | #84已合并main ed432da；head 28cc68f的required verify与独立构建通过；合并前后Git tree一致 |
| SEO / App / Worker / 路由部署 | passed | App及静态Site生产绑定ed432da，Worker独立Linux镜像9e0d667b6f4c；旧5个/_astro与6个/_app-assets生产真实200、SHA256一致 |
| 域名 / 证书 | passed | 现有www正式域名HTTPS与生产别名正常；SEO使用固定生产vercel.app，无新增DNS依赖 |
| OAuth / 归属 | passed | 原真实Google登录验收保留；修复版真实会话正常，全部5个历史任务归属一致；另一个owner既有准入及私有任务元数据已证实存在，当前会话访问404且未进入历史 |
| 真实图片 / 视频生产烟测 | passed | 前轮四项新操作及旧图片接口均真实成功；本轮共享投递路径用一次视频验证，READY/settled、MP4/24fps/音轨/单次扣2点及浏览器导出通过；图片请求格式未改变且未追加收费调用 |
| 即时云端投递 | passed | 真实浏览器样图预检约19.5秒完成，投递attempts=1、无错误，创建执行的是专用Invoker身份，证明Vercel直接投递而非依赖Worker ADC恢复；没有Provider调用或额度变化 |
| 有界故障恢复 / 最近任务 / 统一Provider | passed | 故障红绿、操作浏览器及生产隔离超时任务通过：无attempt、预留/返还各一次、REFUNDED、队列completed；2个QA对象精确清理，财务审计保留；既有四任务与新视频完整可见 |
| 回滚资源核对 | passed | 上一版App不可变部署仍READY，旧Worker镜像digest仍可读取；未在生产执行回滚演练。回滚前应停止新准入并处理未完成退款意图，不能把资源存在当作已演练 |

2026-10-25更新：正式站35个公开页面、84项只读检查全部通过，包含canonical、索引、sitemap、真实404、视频入口及背景工具负向区域。桌面1440与手机390宽真实工作区已检查，浏览器实际导出普通/精修JPG和MP4；精修上一版本可切回，PRO无精修入口。视频原/结果播放位置同步，3帧抽查水印去除、产品字样保留；音频AAC存在且非静音。样本为自有合成短片，不能据此外推复杂动态水印的质量。诊断补丁仅发布App，Site因未受影响按ignore规则取消构建，原静态生产部署继续服务；正式站6个上一版App资源再次核对200与SHA256一致。

真实账号为管理员分配30点测试处理额度，PRO/精修/视频共消耗6点；剩余24点已通过带审计reference的撤回操作清理，处理余额回到0。现有免费余额1；旧接口验收包含正常每日签到。零额度真实浏览器PRO报价显示需要3点/余额0，确认按钮禁用且明确未开始处理，未发收费请求；该真实浏览器上传预检也证明R2 PUT/CORS可用。归属验收使用当前真实账号和已证实存在的foreign owner QA对象，不是两个真实账号各自完整处理的证明。

脱敏证据保存在忽略的output/acceptance/：site-records四项真实任务、legacy-functional.json、www-public-final.json、ownership-final-readonly-audit.json、app-asset-production-retention-85f7c54.json，以及实际输出/桌面手机截图。Cookie、供应商session、签名地址和账号标识不进入本文件或Git。即时投递与故障恢复现已通过生产验证，T9已完成。

## 外部条件

确认现有云账户/部署权限、Provider 开通与余额、R2 生命周期/CORS、任务执行平台和非免费操作额度策略。先检查已配置的能力；任何缺口只阻塞依赖该条件的发布，继续全部可独立实现/测试的工作。不在聊天索取密钥。

## 2026-10-25 补充修复（用户已确认执行）

即时投递的STS参数错误与不确定投递的无限排队是两个独立问题。#83仅增加脱敏诊断，不能视为修复后者。修复前只读快照中，正式站当时为85f7c54，四项新操作已启用；财务表5笔准入均为settled、没有reserved，12条outbox均completed、没有uncertain引用。该历史快照未发现此类冻结，不能替代异常分支验收；最终状态以发布门禁表及修复版生产验收结果为准。

1. P0：先补任务与额度的有界恢复。派发前持久化nonce、首次派发时间、绝对恢复期限与generation；周期协调器同时处理从未启动Worker的任务。只读执行列表缺失不能证明请求未受理。恢复Worker沿用同一job/准入记录，有attempt时只查既有结果；到期需通过同一CAS/租约先阻止迟到Worker再幂等返还未开始处理的额度。已可能调用Provider的任务进入既有核对机制，不能清空attempt、重发收费请求或直接无条件返还。跨R2/财务写入崩溃后必须可重入完成。
2. P1：分离Google STS的资源名audience（//iam.googleapis.com/...）与Vercel令牌的HTTPS audience。保留原身份、权限、作用域。用户“确认执行”已批准此示例偏差；真实SDK生成STS请求体的红测已转绿，发布后用零收费真实浏览器上传预检证明直接启动云执行。
3. P2：最近任务按成功准入记录取数后分页，保证未提交的PREPARED记录不能挤掉有效任务；兼容已有索引。补20条以上未准入记录、并发幂等提交、分页无遗漏/重复及跨账号隔离测试。任务消失是展示缺陷，不能表述为已删除任务或财务记录。
4. 同轮修复PR82另一条P1：扩展/适配项目规定的WatermarkProvider契约，新旧处理入口共用该边界；保留旧API兼容，取消独立平行的供应商契约。先做四操作与旧接口兼容、Mock可替换的契约测试。

故障红测必须覆盖：首次POST从未到达、已受理但响应丢失、响应不可解析、匹配执行落在第六页、超过绝对期限、迟到Worker与返还竞争、返还各写入点崩溃、重复调度、已提交Provider的未知响应。验收必须证明有界结束/核对、最多一次收费提交、最多一次扣减与返还；正常成功流程不能替代这些故障验证。

合并前执行定向红绿、一次release:verify与required CI。生产先跑免费预检、旧结果回放、真实浏览器状态与隔离验证；需要一次收费全链路时优先使用剩余视频预算，图片上限保持8。代码/CI、生产SHA、云身份、任务恢复、账本及UI分别记录门禁，T9保持未完成直到适用项全部通过。

审查依据：[#82无限排队P1](https://github.com/teddy920810/ai-watermark-remover/pull/82#discussion_r4367483134)、[Provider边界P1](https://github.com/teddy920810/ai-watermark-remover/pull/82#discussion_r4367483138)、[最近任务P2](https://github.com/teddy920810/ai-watermark-remover/pull/82#discussion_r4367483140)。参数依据：[Google STS](https://docs.cloud.google.com/iam/docs/reference/sts/rest/v1/TopLevel/token)、[Vercel令牌audience](https://vercel.com/docs/oidc/gcp#custom-audience)。初次只读诊断未调用付费Provider；本轮按用户确认继续实施及生产验收。

恢复期限取不可变的job.createdAt（未开始处理15分钟）或attempt.startedAt（已开始处理24小时），不会随投递重试延后。每次Cloud Run执行先以R2 CAS保存独立nonce；有界列表没有匹配时只查询原执行，到期先在相同租约写入refundIntent，再幂等退款。退款提交响应丢失、进程退出均可继续完成。已有结果保存/结算不执行投递退款；迟到Worker的每次CAS与heartbeat同时检查租约epoch及执行代次。最近任务由财务准入账本决定成员，并以保留微秒精度的keyset分页获取R2权威状态；不再受未准入PREPARED索引的数量影响。

明确未被受理与结果不确定分开处理：仅首次启动时，取得Google凭证失败（尚无Cloud Run POST）或Cloud Run明确返回非408的4xx拒绝，才能把该投递代次标记为未受理，供下次调度用新nonce重试相同job/准入记录。这保留Vercel临时鉴权失败后由Worker ADC恢复的能力。已存在执行的查询/鉴权失败、网络中断、408/5xx、成功响应不可解析及outbox确认丢失，均不允许据此另发启动请求。

本轮TDD记录：STS真实SDK生成请求体2项红测转绿；投递新增持久nonce、5页列表缺失、响应丢失/不可解析、未启动超时、财务提交前后中断、代次替换、迟到结果等红测转绿。恢复模块20项、Worker27项、Cloud Run30项、运行时装配37项分别通过；最近任务6项红测转绿，相关39项通过；Provider统一边界相关27项通过。以上为重叠范围，不能相加当作独立测试总数。新增操作浏览器用例证明排队→退款、余额恢复、显式重新报价、刷新均不会自动POST新任务。

本地release:verify执行依赖审计、站点校验和全量786项单测/覆盖率；首轮因新测试夹具可选字段类型、随后因测试声明prefer-const停止，均已修正。已通过的审计与全量覆盖不再重复叠加；补齐类型/Lint、Build、30项浏览器的缺失范围。首轮四并发浏览器29项通过，1项既有多落地页用例超过30秒；排查确认4379测试进程退出、端口释放，保留首轮trace和截图，原断言单并发120秒上限定向补验通过（29.6秒）。未修改测试断言或仓库超时配置。覆盖率：语句83.40%、分支81.15%、函数84.68%、行91.05%；依赖审计无high/critical，现有1 low/4 moderate告警未在本次扩大依赖升级范围。

最终补充明确未受理的调度恢复后，Cloud Run/运行时相关75项定向测试通过，全量794项单测通过；覆盖率语句83.50%、分支81.33%、函数84.68%、行91.11%。再次运行release:verify的审计、站点校验、单测、类型/Lint及Build均通过；本机四并发浏览器28项通过，2项在页面/文件交接等待中超时。保留了首轮证据；复制仍在写入的trace时曾触发Windows Vite EBUSY，随后仅在测试进程退出、端口释放后归档完整证据。原断言单并发定向补验2/2通过，未放宽仓库配置。CI run 40160921650完整verify成功，30项浏览器全部通过；独立构建run 40160921677成功。本机命令中途失败和等价补验分别保留，不能表述为首次完整命令零失败。

## 修复版生产验收结果

- 发布：#84已合并main ed432da89d84585fc6bc4a2703e461e6aa687672；head与main tree均为d9ca01f6426c3ab226c1d08e7012ad5a2a5a6272。App部署dpl_49dPJFH9Fv8s3Sf9QEUQnbJqUK3A，Site部署dpl_Ghyh23oBqcbgDvNmctscUGDUZVF5均READY并绑定该SHA；Worker generation 4、Linux镜像sha256:9e0d667b6f4c270389c18ce9f26f28f52c2e5c0fcd6a0114882ae188300ae5b1，镜像上下文严格7个文件，没有上传checkout或密钥。正式别名与自动分配域名设置已回读确认/恢复。
- 免费预检：真实IAB会话上传自有JPEG，经实际R2 PUT/CORS和新Worker检查完成；执行创建者为专用Invoker身份，19.539秒完成、一次投递、无诊断错误，处理余额维持0，Provider预算未增加。
- 故障恢复：使用有明确manifest的隔离过期QUEUED视频记录及不存在的输入，通过生产Worker验证到期返还；没有Provider attempt，账本仅一次reserve(-1)及refund(+1)，状态REFUNDED/dispatch_timeout，outbox completed。已按ETag清理两个QA控制对象并验证不存在，没有删除财务审计。
- 真实视频：仅新增一次固定区域视频处理，确认2点、只扣2点，READY/settled；实际下载MP4为512×320、24fps、3.018秒、有音轨。浏览器导出成功，音频mean -21.1 dB/max -17.7 dB；桌面1440与手机390宽均无横向溢出，原/结果播放与暂停位置已核对。样本为自有3秒合成短片，不代表复杂移动水印或9分钟大文件质量验收。
- 历史与归属：新视频和原四任务均可见，对全部5个返回任务核对准入owner一致；其他owner已有任务私有元数据经HEAD证实存在，当前真实会话GET返回404，未进入当前历史。未登录第二个Google账号，不把这一检查表述为两个账号各自完整处理的证明。
- 资源与余额：公开生产smoke通过，旧5个/_astro及6个/_app-assets在实际www域名均200且SHA256不变。验收快照为全库准入6 settled/1 refunded/0 reserved；17条outbox全部completed，无uncertain引用待恢复。新增分配2点测试额度已用于该视频，余额回到0，原免费余额1；没有多余测试额度需要撤回。
- 边界：域名、证书、终端用户OAuth配置、R2生命周期/CORS没有新增变更；沿用先前真实验收，并用本轮会话、上传及下载验证共享链路。回滚仅核对旧部署和镜像可用，没有实际生产回滚。未运行额外图片处理、未创建周期收费烟测、未修改原checkout的10项用户改动。

本轮证据：repair-release.json、repair-readonly-*.json、dispatch-refund-production/verified.json及cleanup记录、repair-site-records/、repair-video-functional.log、repair-legacy-assets.json、app-asset-production-retention-ed432da-detail.json、repair-video-production-desktop.jpg/mobile.jpg。真实Cookie、Provider session、签名地址和账号标识仅保存在私有忽略目录，不进入仓库。
