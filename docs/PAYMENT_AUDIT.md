# 支付实现、验收边界与剩余工作

审计日期：2026-11-01（Asia/Shanghai）。实施基线为已合并 `988656d5f6aeb482a6bf7ba76b79975a25b14adb`，不是未合并候选或旧 Sandbox 部署。支付配置及发布合同见 [PayPal 发布说明](PAYPAL_LIVE_RELEASE.md)。本次修复的 PR、CI、部署和验收结果须绑定最终版本记录，不能把下列历史证据当作新补丁已经通过。

## 通用Credits本地候选补充

通用Credits候选已进入本地实现，默认关闭；下文三类权益与生产证据仍按原日期/版本阅读。新普通100、PRO300、精修100、背景10、物体10，视频为`100 * ceil(服务端秒数 / 2)`，不是100/秒。来源转换、奖励、预算和切换以[当前Credits合同](PROCESSING_CREDITS.md)为准。套餐不改、购买不开放，旧单恢复与金额保持；候选代码、PGlite、mock浏览器、真实PG、真实Provider、人工支付/资金退款、部署和生产验收分别结清。本地窗口真实发行/DB/Provider为0；人工付款与资金退款按用户要求暂缓。

## 当前商业与运行边界

2026-11-01 的生产公开 `GET /api/payments/catalog` 回读为 `environment=live`、`enabled=false`、`creditsEnabled=true`，新购买关闭，已购余额支持保留。未开启 Live、支付、退款、充值、自动发额度或新增 Provider 调用。开关是运行事实，未来发布及开放前应重新回读；公开响应不能证明私有批准标志或商户资格。

| 已批准图片套餐 | USD | 已购图片 Credits |
| --- | ---: | ---: |
| Starter | 4.99 | 4,990 |
| Plus | 9.99 | 9,990 |
| Pro | 19.99 | 19,990 |

服务端 `PAYPAL_CATALOG_JSON` 和目录版本决定订单快照，`image-credit-prices.ts` 与独立操作费率版本决定图片消费；CMS、URL 和浏览器不能决定金额。普通去水印、背景移除、物体移除分别使用 100、10、10 个已购图片 Credits；免费次数可用时优先使用一次免费次数。预览、比较、本地背景编辑和重复下载不扣费。

三类权益不可相加或互换：

- `freeUses`：首次登录 1 次，日签到 +1，奖励发放上限 3；失败按原来源返还可能使余额超过奖励上限。
- `purchasedImageCredits`：PayPal 图片购买批次余额；仅适用于普通去水印、背景移除、物体移除。Pro 套餐不解锁 PRO 模式。
- `processingCredits`：管理员独立分配；当前服务端报价为普通/精修 1、PRO 3、视频 `ceil(durationSeconds * 0.5)`。普通图片在无免费、已购余额不足而管理员余额可用时保留既有管理员额度路径；以报价中的明确单位为准。它不是已购图片 Credits 的公开售价。

未来 PRO 300 或视频 100/秒的图片 Credits 方案只是历史规划值，没有启用，也不在本次变更中实现。供应商原始成本、用户售价和管理员额度不能混称。

## 实现与证据逐项对照

| 环节 | 已实现合同与代码 | 验收边界 |
| --- | --- | --- |
| 公开 Pricing | App SSR 的 `/pricing` 从 `publicPaymentCatalog` 读取白名单投影，`no-store`、可索引、有 canonical；纯目录不加载 SDK、不创建订单 | 生产 HTML/公开接口可只读验证；显示价格不等于可以付款 |
| 选 SKU 与结算 | `checkout-selection.ts` 只接受目录 SKU 和同源返回路径；`/app/credits` 为 private/no-store/noindex；先确认最新目录再加载 SDK | 页面测试中的网络桩及伪 SDK 只证明交互；真实买家批准另验 |
| 账户隔离 | 当前稳定 Google owner、`buyer` 登录和同源写入校验；订单查询、request key、浏览器活动购买按账户隔离，数据库另按 sandbox/live 隔离 | 不以 PayPal 邮箱合并账户；真实 OAuth 历史验收不证明新的真实交易 |
| Create | 服务端保存 SKU、金额、币种、Credits、目录版本；环境/owner/request key 唯一；供应商请求使用原本地订单 ID 的稳定幂等键 | 新单仍受购买开关、目录和限流约束；原购买恢复见下文 |
| Capture | 服务器 Capture 后 GET 权威订单，核对 merchant、金额、币种、三个引用和单 capture，仅 COMPLETED 发点 | 浏览器 onApprove、PENDING、超时和 HTTP 200 本身都不能当作到账证据 |
| Webhook | PayPal postback SUCCESS 验签后持久 inbox；未完成事件可重试，已完成事件去重；APPROVED 仍走服务器 Capture，COMPLETED 重新 GET | Live 配置查验不等于真实投递；重送 202 不等于实际回调 200 |
| 到账与消费 | 同一事务去重 capture/批次/ledger；FIFO 可跨购买批次分配；余额不足不部分扣；原任务不因新价格重复预留 | PGlite、真实 PostgreSQL 锁竞争、真实 Provider 与真实购买消费是不同证据 |
| 失败返还 | 按原 amount、单位和批次分段返还；已冻结购买批次不复活；UNKNOWN 和迟到结果保持既有围栏 | 本次不改变处理 Worker、Provider 重试、退款期限或原操作预算 |
| 资金退款、撤销和争议 | 已验签通知冻结受影响批次；先于到账的调整阻止发点；未使用全额退款可终态 refunded，部分/已用/争议进入 review | 未提供用户自助资金退款或争议自动解冻。资金操作由账户持有人在 PayPal 执行，不是任务失败自动退额度 |

历史实际证据的适用范围：

1. **旧 Sandbox，2026-10-25**：`output/paypal-full-flow/full-flow-result.json` 记录旧快照网页虚拟 USD 4.99 购买 5 Credits、到账、同账户重登、未使用全额退款及实际重复通知。原验收说明保存在忽略的历史恢复材料中。其 5/15/40 示例目录、旧身份及部署不能覆盖当前 4,990/9,990/19,990 商业目录。未验真实图片消费、部分退款或当前 Live。
2. **Live 配置，2026-10-31**：`output/paypal-live/live-paypal-config-check.json` 记录 OAuth/既有 Webhook 查验成功、直接 URL 和五项订阅正确；明确没有创建 Live order、capture 或 refund。商户审核完成仅有当时账户持有人报告，开放前还须本人确认实际资格及限制。
3. **当前架构历史金融与处理验收**：`output/refactor-release-2026-11-01/postgres-full.log` 的隔离 Sandbox 多连接测试及 schema 清理证明记录版本的并发场景；该轮六项真实处理仅消耗免费/管理员额度，`release-result.json` 的 `purchasedImageCredits=0`。它们不能证明 Live 付款或已购钱包实际消费。
4. **本次工程回归**：定向单元/SQL、隔离真实 PostgreSQL 和浏览器状态回归按本次源码运行，首失败和修复后结果分别保留于 `output/optimization-round2-2026-11-01/T4-*`。浏览器支付回归仍是网络桩，不伪装真实交易。

## 原购买恢复合同与本次修复

### 创建响应丢失后的目录变化

服务端已保存订单，但浏览器只保留 SKU 和 request key、尚无 order ID 时，原实现先查当前目录。SKU 下架返回 400；金额、Credits 或目录版本变化会撞上 store 的快照冲突守卫而失败。浏览器已有 order ID 的 GET/Capture 不经过当前目录，不受这条问题影响。

修复后，购买启用时先按 **同 environment + owner + request key** 查询原订单，再核对请求 SKU；恢复返回原 ID 和原金额、Credits、目录版本。仅首次购买使用当前目录。原 store 的快照冲突守卫、不同 SKU 冲突、跨 owner/environment 隔离均保留。新购买暂停时 Create 继续拒绝；已有 ID 的查询和 Capture 仍沿既有恢复路径，不借修复绕开暂停政策。

如果本地原订单尚未绑定远端 ID，仍使用原快照和原 PayPal 请求键接续。供应商幂等键有保存期限，不能据此承诺无限期安全重发。超期且供应商 Create 结果不明时，应由维护者查账并确认原记录，不能删本地单、清 key、换 key 或新建替代支付来试探。

### 确定未批准的订单继续买家批准

原订单恢复后，Check payment 可能得到服务器明确的 `422 ORDER_NOT_APPROVED`。旧 UI 保留活动购买，却同时隐藏 PayPal 按钮和检查区，仅剩“继续 PayPal”文字。

现在仅在该明确状态、原订单为 created 且有远端 ID、活动购买的 order/SKU/request key 与当前按钮一致时，允许显示原 PayPal 批准按钮。依旧使用现有 `createOrder → 原远端 ID → onApprove → 服务器 Capture` 合同，批准本身不发点。UNKNOWN、网络超时、403、待确认、身份或商品不符均不开放另一笔付款；终态退款/审核也不重新批准。SDK 地址、属性和官方回调形状没有改动。

## 可执行剩余工作与费用边界

| 责任类别 | 工作与完成标准 |
| --- | --- |
| 研发，本次交付 | 两条恢复缺口先红后绿；验证原价、同 key、owner/environment、换 SKU 冲突、暂停和不重复支付；新 SQL 精确查询有隔离真实 PG 并发证据；一次 `release:verify`、精确 PR head 必需 CI、审查、适用目标部署及只读生产验收。正式购买仍关闭。 |
| 开放前，账户持有人 | 在真实 Live 账户确认商户收款资格和无产品限制，核对批准目录、实际费率、直接回调和五事件；所有凭据只经安全存储，不贴入聊天或仓库。 |
| 开放前，人工资金验收 | 单独批准交易次数、买卖双方及金额后，本人真实付款；核对 PayPal COMPLETED、回调实际 200、订单/单次 grant/稳定账户、原订单恢复和重复通知幂等。退款由本人操作并核对原批次冻结、ledger 和页面结果。 |
| 开放前，已购额度消费 | 单独批准每项调用及费用，核对真实 100/10/10、原来源扣返与任务恢复。上轮已用完的图片/视频调用槽不能复用；免费/管理员真实成功不能代替已购消费。未使用全退与消费后 review 是不同场景，不能在同一单上同时宣称通过。 |
| 业务决定，另行授权 | 何时开放购买/Live 批准开关；测试资金与手续费预算；是否扩展 PRO/视频购买、自助退款或争议解冻。不因审计自行开户、充值、发额度、买服务或更改既定价格。 |

本次本地网络桩和 PGlite 不付真实款、不调用 Provider；真实 PG 只在已验证隔离 Sandbox 中新建唯一临时 schema，结束仅删除该 schema，不写生产账本。生产工程验收只读公开目录、Pricing、私有结算和负向区域；不通过真实交易来验证“关闭”。

如果账户适用 [PayPal 中国跨境商户公开费率](https://www.paypal.com/c2/business/paypal-business-fees?locale.x=en_C2)，公开标准为 4.4% + USD 0.30；USD 4.99 约为 USD 0.52 收款费，退款不返原收款费。账户协议、优惠、币种兑换或买家费用须实际确认，不把该估算当账单或承诺零成本。Provider 另计。当前新增交易及 Provider 预算均为零，任何后续资金验收必须先给出具体次数、金额和成本。

## 发布和运行复核

- 固定候选/合并 SHA、必需 CI 和目标产物；本次改变 App 支付逻辑，Site/Worker 未消费这些实现时不重复部署。保留已发布哈希资源、旧 API、任务、批次和金融历史。本次保留原 App 26 项 pin，并追加生产 `988656d` 的旧结算入口，共 27 项；从该不可变部署逐字节回读全部 pin，12 项当前资源图与最终 App 产物一致。Site 14 项 pin 不变。
- 部署后回读 App 实际 alias 和预期 SHA，确认 `enabled=false` 与原目录/100/10/10。检查 Pricing 和私有结算桌面/移动及 Blog 负向区域，运行一次 public-only smoke。未改变 DNS、证书、OAuth、R2、CORS 或处理 Provider 时，对应配置/收费 smoke 为 not applicable。
- 工程代码/仓库/部署可以结清；**Live 付款、实际回调、退款和已购消费仍是独立 pending 门禁**，未经人工真实证据不能称支付上线完成。暂停/回退只停新购买，不冻结全部用户、删除账本或把已购额度改成管理员额度。
- 维护者关注未完成 payment inbox、created 长期未结订单、review 批次及余额差异；供应商重投有界，超窗事件需查原交易后人工恢复。当前没有额外的自动资金退款/争议解冻流程，本次不暗中引入。
- 未改变内容模型或 CMS 字段，无 CMS 迁移；未增加临时适配器或删除兼容项，因此不改内容基线及兼容退出清单。原 14 项内容字节、T3 内容 API/草稿、T5 原 PNG、T6 视频说明均保留。

## 官方集成依据

2026-11-01 只读复核：

- [Standard Checkout](https://developer.paypal.com/studio/checkout/standard/integrate)：浏览器调用服务器 Create/Capture，createOrder 返回服务器订单 ID。
- [REST 幂等](https://developer.paypal.com/api/rest/reference/idempotency/)：请求键只在供应商保存窗口内提供去重；并发相同请求可能有一次失败，不能更换键重付。
- [Webhook 验签与重投](https://developer.paypal.com/api/rest/webhooks/rest/)：真实 App 事件 postback 验签；失败重投最多 25 次/3 天；Simulator 不能代替这条验签闭环。
