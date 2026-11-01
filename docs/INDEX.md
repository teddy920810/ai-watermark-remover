# 当前规范与历史资料索引

本索引由改动执行者随受影响合同更新，复核者核对语义。代码、内容、协议和发布设置各有自己的权威来源；历史测试结果不代表当前生产状态。

| 当前规范 | 范围与权威依据 |
| --- | --- |
| [项目规则](../AGENTS.md) | 授权、TDD、唯一维护目录和风险门禁 |
| [当前架构](CURRENT_ARCHITECTURE.md) | 当前源文件、协议与职责索引 |
| [开发指南](DEVELOPER_GUIDE.md) | 本地开发；配置与命令以package.json为准 |
| [测试指南](TESTING_GUIDE.md) | 选择一次覆盖实际风险的本地门禁；公共与真实功能验收分开 |
| [独立部署](../apps/DEPLOYMENT_TARGETS.md) | Site/App/Worker构建与路由 |
| [运维](OPERATIONS_RUNBOOK.md) / [Worker](product/WORKER_DEPLOYMENT.md) | 域名、短期身份、生命周期与恢复 |
| [账户身份](ACCOUNT_IDENTITY.md) / [管理员额度](PROCESSING_CREDITS.md) / [图片Credits](PAYPAL_LIVE_RELEASE.md) | 三类权益、价格目录、退款与发布顺序 |
| [CMS教程](PAGES_CMS_GUIDE.md) / [建站模板](TEMPLATE_GUIDE.md) | 内容编辑和有限模板；不配置真实能力/费率/Provider |
| [图片展示](product/IMAGE_DISPLAY.md) / [素材清单](product/CONTENT_MEDIA_MIGRATION.json) | 单/双图、失败降级、内容归属与已撤销的P5替换；运营素材待办 |
| [上线剩余工作](product/RELEASE_READINESS.md) | 待实施清理、最终审查、真实验收、授权发布、观察与兼容退出 |
| [App工作区](product/APP_WORKSPACE.md) | 六类新操作的共同协调、选区差异、状态/草稿归属和旧API兼容 |
| [统一文件入口](product/FILE_INTAKE.md) | 公共入口、App再次选文件/拖入、推荐提示、CMS边界与本地草稿 |
| [功能交付](FUNCTIONAL_TOOL_DELIVERY.md) / [贡献指南](../CONTRIBUTING.md) | 操作合同、验证与规范同步 |
| [后端组装与事务归属](product/BACKEND_OWNERSHIP.md) | 免费权益原语、同次读取、恢复候选及Web/Worker资源责任 |
| [图片操作迁移](product/IMAGE_OPERATIONS.md) | 逐操作准入、PNG/费用、供应商恢复与旧协议退出边界 |
| [兼容与退出](COMPATIBILITY.md) | 旧消费者/资源的退出证据，禁止按时间自动删除 |

| 其他资料 | 状态 |
| --- | --- |
| [处理架构](product/PROCESSING_ARCHITECTURE.md)、[产品设计](product/PROCESSING_PRODUCT_DESIGN.md) | 设计依据；按其中日期和已接受决定阅读，当前运行事实见当前架构 |
| [配置合同](product/PROCESSING_CONFIGURATION.md) | 当前配置规范；默认值不表示生产开启状态 |
| [原MVP PRD](history/AI_Watermark_Remover_MVP_PRD_Technical_Solution.md) | 逐字节历史归档，不作为当前免登录/接口规则 |
| [原实施台账](product/IMPLEMENTATION_TODO.md) | T0–T11历史实现与验收，预算和测试数不继承到新任务 |
| [单次处理交互](product/INTERACTION_SIMPLIFICATION.md)、[头部上传](product/HEADER_UNIFIED_UPLOAD.md)、[设计QA](../design-qa.md) | 已接受交互与历史发布证据；保留首失败及待验收 |
| `docs/templates/`、`cms-templates/` | 可执行/可复制模板，与消费者一起维护 |

当前本地重构的唯一阶段状态在[正式台账](product/REFACTOR_LEDGER.md)。原 output 草稿只保留指向它的入口；方案历史快照与历史材料分类见[归档索引](history/README.md)。本地证据仍留在忽略目录，不把凭据或历史产物加入源码。

当前规范、决策背景/ADR、历史发布/验收与可执行模板按上表分开；历史文中的“当前”和预算只指其记录日期，不能覆盖现行合同。

CMS保存、required CI、Vercel构建和生产验收是独立门禁。当前CMS主分支直写路径仍存在；外部保护及发布设置未核实/未获修改授权时，记录为pending，不能声称已阻止绕过。
