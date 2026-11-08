# 当前规范与历史资料索引

本索引由改动执行者随受影响合同更新，复核者核对语义。代码、内容、协议和发布设置各有自己的权威来源；历史测试结果不代表当前生产状态。

| 当前规范 | 范围与权威依据 |
| --- | --- |
| [项目规则](../AGENTS.md) | 授权、TDD、唯一维护目录和风险门禁 |
| [当前架构](CURRENT_ARCHITECTURE.md) | 当前源文件、协议与职责索引 |
| [开发指南](DEVELOPER_GUIDE.md) | 本地开发；配置与命令以package.json为准 |
| [测试指南](TESTING_GUIDE.md) | 唯一本地检查与生产验收矩阵；选择一次风险门禁，公共与真实功能验收分开 |
| [独立部署](../apps/DEPLOYMENT_TARGETS.md) | Site/App/Worker构建与路由 |
| [运维](OPERATIONS_RUNBOOK.md) / [Worker](product/WORKER_DEPLOYMENT.md) | 域名、短期身份、生命周期与恢复 |
| [账户身份](ACCOUNT_IDENTITY.md) / [Credits与旧额度](PROCESSING_CREDITS.md) / [支付](PAYPAL_LIVE_RELEASE.md) | 统一Credits、旧三类权益兼容、逐账户转换、价格目录、来源退款与发布顺序；仓库默认关闭，生产启用以版本发布记录为准 |
| [支付审计与剩余门禁](PAYMENT_AUDIT.md) | 原订单恢复、代码/旧Sandbox/Live证据、人工交易与费用边界；工程发布不等于开启收款 |
| [CMS教程](PAGES_CMS_GUIDE.md) / [建站模板](TEMPLATE_GUIDE.md) | 内容编辑和有限模板；不配置真实能力/费率/Provider |
| [运营快读](CONTENT_API_QUICKSTART.md) / [内容 API 技术合同](CONTENT_API.md) | 内容域 Bearer Token、Git 变更集、素材、具体差异批准、受保护发布与完整 JSON；生产启用须核对凭据和实际验收 |
| [图片展示](product/IMAGE_DISPLAY.md) / [素材清单](product/CONTENT_MEDIA_MIGRATION.json) | 单/双图、失败降级、内容归属与已撤销的P5替换；运营素材待办 |
| [发布记录与兼容观察](product/RELEASE_READINESS.md) | 按版本区分重构发布、后续交付、历史发布前标准与剩余观察 |
| [App工作区](product/APP_WORKSPACE.md) | 六类新操作的共同协调、选区差异、状态/草稿归属和旧API兼容 |
| [统一文件入口](product/FILE_INTAKE.md) | 公共入口、App再次选文件/拖入、推荐提示、CMS边界与本地草稿 |
| [免费 Gemini](product/FREE_GEMINI.md) | 独立浏览器图片/视频操作、原文件付费交接与本地/发布验收边界 |
| [功能交付](FUNCTIONAL_TOOL_DELIVERY.md) / [贡献指南](../CONTRIBUTING.md) | 操作合同、验证与规范同步 |
| [后端组装与事务归属](product/BACKEND_OWNERSHIP.md) | 免费权益原语、同次读取、恢复候选及Web/Worker资源责任 |
| [图片操作迁移](product/IMAGE_OPERATIONS.md) | 逐操作准入、PNG/费用、供应商恢复与旧协议退出边界 |
| [兼容与退出](COMPATIBILITY.md) | 旧消费者/资源的退出证据，禁止按时间自动删除 |
| [过期恢复字段擦除](product/SENSITIVE_RETENTION.md) | 手动预演、计划digest、关联组与条件写；不启用自动调度，不删除媒体或金融依据 |

| 其他资料 | 状态 |
| --- | --- |
| [处理架构](product/PROCESSING_ARCHITECTURE.md)、[产品设计](product/PROCESSING_PRODUCT_DESIGN.md) | 设计依据；按其中日期和已接受决定阅读，当前运行事实见当前架构 |
| [配置合同](product/PROCESSING_CONFIGURATION.md) | 当前配置规范；默认值不表示生产开启状态 |
| [原MVP PRD](history/AI_Watermark_Remover_MVP_PRD_Technical_Solution.md) | 逐字节历史归档，不作为当前免登录/接口规则 |
| [原实施台账](product/IMPLEMENTATION_TODO.md) | T0–T11历史实现与验收，预算和测试数不继承到新任务 |
| [单次处理交互](product/INTERACTION_SIMPLIFICATION.md)、[头部上传](product/HEADER_UNIFIED_UPLOAD.md)、[设计QA](../design-qa.md) | 已接受交互与历史发布证据；保留首失败及待验收 |
| `docs/templates/`、`cms-templates/` | 可执行/可复制模板，与消费者一起维护 |

P0–P7阶段及PR98原始发布证据在[重构台账](product/REFACTOR_LEDGER.md)，2026-11-01后续交付从[发布记录](product/RELEASE_READINESS.md)进入。台账中的本地阶段快照不代表后续版本仍未提交或上线。原 output 草稿只保留指向台账的入口；方案历史快照与历史材料分类见[归档索引](history/README.md)。本地证据仍留在忽略目录，不把凭据或历史产物加入源码。

当前规范、决策背景/ADR、历史发布/验收与可执行模板按上表分开；历史文中的“当前”和预算只指其记录日期，不能覆盖现行合同。

CMS保存、required CI、Vercel构建和生产验收是独立门禁。2026-11-01的PR98发布已回读受保护PR、严格必需CI、管理员约束及模板草稿流程；后续内容API的真实草稿发布证据见发布记录。运营仍须在明确授权范围审阅具体差异；后续发布时重新核对保护设置和实际发布结果，不能把历史快照当作永远有效的外部强制保证。
