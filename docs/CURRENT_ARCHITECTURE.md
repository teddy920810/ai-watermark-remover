# 当前架构与合同所有者

适用范围：当前源码。改动执行者同步本页，复核者核对合同。版本与生产信号从具体发布记录读取，不在本页维护实时SHA。

- `src/`是产品单一源码；`apps/site/src`与`apps/app/src`是路由发现容器。Site静态输出公开内容，App承接私有页面/API和同域代理，Worker独立执行耐久任务。可选gateway不是当前生产拓扑。
- 内容/SEO拥有图片路径、命名、字节、alt、示例说明与全部页面内容。2026-11-01已撤销P5替图，恢复原内容；研发仅维护ImageDisplay的单/双图及失败机制。原图烘焙控件和缺失资产由运营决定，不由重构替换，见[图片展示](product/IMAGE_DISPLAY.md)。
- [操作目录](../src/lib/contracts/operation-catalog.ts)拥有六类能力、输入/输出类型、协议、限制、计费来源和执行器映射；`watermark-removal`是普通图片的旧协议ID。六类新客户端操作均通过v1/Worker；旧JobService准入、查询、下载和已接受记录继续兼容。目录不决定运行开关，也不存密钥或复制售价。
- [路由规则](../src/lib/contracts/route-policy.mjs)分别定义目标归属、私有性、索引与CMS已知入口。公开内容静态生成；精确`/pricing`是App提供的公开SSR例外，使用服务端白名单目录、canonical和no-store，不加载支付SDK/订单。`/app/credits`保留私有确认/支付/订单与原activeAttempt恢复，Site不导入支付私有配置。App入口与未知SEO路径不混为一类。
- [ProcessingService](../src/lib/processing/processing-service.ts)拥有报价、准入、原始报价保留与任务恢复；服务端运行时组装处理price book。[图片费率](../src/lib/payments/image-credit-prices.ts)拥有三种图片工具的费率/版本；[支付目录](../src/lib/payments/payment-config.ts)投影白名单公开DTO。CMS不覆盖能力、费率、Provider、上传或比较规则。
- PostgreSQL拥有稳定身份、金融准入、支付账本和outbox。旧账户保留免费次数、购买图片Credits、管理员处理Credits三个明确单位；默认关闭的通用Credits候选由`credit-policy.ts`和`postgres-credit-wallet.ts`管理一个可消费单位及奖励/管理员/购买来源批次。逐账户排空、来源证明和原子转换独立于部署；默认不开启、不自动迁移旧账户，详见[Credits合同](PROCESSING_CREDITS.md)。
- 免费权益初始化共用调用方事务client；账户响应复用当次summary内已读购买余额，恢复候选仅查询一次。Web账户与耐久运行时借用同一受限连接池，Worker拥有独立资源；Provider按真实操作惰性组装，见[后端归属](product/BACKEND_OWNERSHIP.md)。
- 私有R2拥有媒体、权威任务、CAS/租约、attempt/receipt。新媒体四个前缀与旧`uploads/results/jobs`按现行生命周期管理；恢复控制记录不能设置全局一天TTL。未知供应商结果、迟到结果和退款意图沿原任务恢复，不重复提交。
- 产物按操作区分：耐久水印图片JPEG/视频MP4/背景RGBA PNG/物体原尺寸PNG；保留原尺寸/透明语义、视频时长/音轨检查、原结果版本及精修关系。真实效果和真实费用单列验收，mock不代表生产能力。
- App入口与image/video兼容深链共用AppWorkspaceLayout/AppShell；六类新操作沿同一耐久协调，物体选区与精修各自保留绘画政策；旧接口在途记录继续恢复。操作选择、文件归属和静态加载/错误壳见[工作区规范](product/APP_WORKSPACE.md)，本地代码迁移与真实Provider/生产迁移验收分别记录。
- 公开模板与页尾CTA使用MediaLauncher；App选择/拖入复用字节识别、限制与本地草稿基础。CMS只提供现有工具类型/状态推荐，已接受任务优先；不兼容或未开放来源明确提示。背景/物体编辑器和图片价格客户端现仅由App消费，公共入口由两个Web目标共用，见[文件入口](product/FILE_INTAKE.md)。
- [运营内容 API](CONTENT_API.md)由App的`/api/content/v1`承接，服务端内容Token与单仓库凭据分开；纯内容schema由Astro与API共用。草稿、原字节公共素材、幂等与批准审计持久到Git内容分支，经具体差异批准、独立基线、受保护PR/必需CI发布。Site只提供静态内容与id/digest发布证明；不读取内容凭据，用户R2/权益/Provider不进入内容服务。

兼容登记和退场条件见[兼容清单](COMPATIBILITY.md)，规范分类见[总索引](INDEX.md)。新的媒体类型包括音频必须另定义真实操作、产物、费用和验收，当前不开放音频处理。
