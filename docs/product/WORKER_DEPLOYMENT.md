# 生产 Worker 部署与验收

更新日期：2026-10-24。本文对应独立 Node Worker 与 `/api/v1` 处理链路。文档、模拟测试和成功构建分别提供实施依据，生产连接、真实输出与扣费必须单独验收。云资源、数据库迁移、Secret 和正式调用由发布负责人按授权执行。

## 执行链路与运行边界

浏览器通过 API 取得私有 R2 的临时 PUT 链接，上传至 staging；`complete` 只持久化预检投递。Worker 在 `preflight` 模式检查真实文件、封存不可被浏览器改写的输入，并登记 artifact。API 据此报价，用户确认后建立金融保留与耐久 outbox。Worker 在 `process` / `reconcile` 模式调用 Provider、保存结果、验证 R2 字节，最后结算。

| 模式 | 所需执行标识 | 职责 |
| --- | --- | --- |
| `dispatch` | 无 | 读取到期 outbox，启动或监控云执行；容器默认模式 |
| `preflight` | `JOB_ID` 为 upload ID，`OWNER_ID` | 实际图片解码、视频探测、遮罩检查与输入封存 |
| `process` | `JOB_ID` 为 job ID，`OWNER_ID` | 首次处理或按既有 attempt 安全推进 |
| `reconcile` | 同上 | 恢复已有结果、查询既有视频任务、结算；已有 attempt 不重发收费请求 |

`DISPATCH_ID` 是云启动请求的关联标识，不是 Provider task ID。一次云执行被接受不代表业务任务完成；outbox 继续检查 execution 或 operation。云启动响应丢失时，适配器保存 `uncertain:` 标识并按任务、归属、关联标识查找既有执行；有限列表查不到也不推断可以再发启动请求，需要保留状态并人工排查。

图片结果和供应商 session、必要恢复标识先落私有 R2 receipt，恢复路径只读取已有 receipt；新增记录不保存未参与实际精修请求的供应商遮罩图。视频 task ID 在上传前持久化，收费提交前持久化 `submitting`；查询出错或收到不明确响应保持待确认。只有供应商明确 `FAILED` 或明确拒绝受理，才按业务契约进入失败与退款。

## 本地构建与最小上传目录

使用 Node 24.22.1 或包含同等修复的后续受支持版本，并按锁文件安装依赖。Worker 镜像固定 `node:24.22.1-bookworm-slim`，容器安装 ffmpeg/ffprobe；宿主的 Windows、macOS、Linux 媒体工具和 `node_modules` 均不复制进镜像。[Node 安全版本说明](https://nodejs.org/en/blog/release/v24.22.1)

在仓库根目录执行：

```text
npm run build:worker
```

脚本先生成 `output/worker/entry.mjs` 与构建清单，再打印一个全新的 `output/worker-context-*` 目录。目录只包含以下文件，构建清单包含源码路径，不包含环境变量值：

```text
Dockerfile
.dockerignore
.gcloudignore
package.json
package-lock.json
output/worker/entry.mjs
output/worker/build-manifest.json
```

只把打印的目录作为 Docker 或 Cloud Build 上下文。脚本按文件白名单复制，不递归复制仓库，不跟随输入文件符号链接，也不删除上次上下文。`.dockerignore` 限制 Docker 读取的文件，`.gcloudignore` 独立限制云构建上传；Cloud Build 在没有显式规则时可能继承 Git 忽略规则，导致 `output/` 被漏传。[Docker 上下文](https://docs.docker.com/build/concepts/context/)、[Cloud Build 上传规则](https://docs.cloud.google.com/sdk/gcloud/reference/builds/submit)

以下为发布负责人执行的命令模板，先替换所有大写占位值。命令保持单行，适用于各平台终端：

```text
docker build --platform linux/amd64 --tag REGION-docker.pkg.dev/PROJECT_ID/REPOSITORY/watermark-worker:RELEASE_ID "CONTEXT_DIR"
```

或由已授权的 Cloud Build 构建并推送：

```text
gcloud builds submit "CONTEXT_DIR" --project=PROJECT_ID --region=REGION --tag=REGION-docker.pkg.dev/PROJECT_ID/REPOSITORY/watermark-worker:RELEASE_ID
```

记录镜像 digest、构建对应的 Git SHA 与本地验证结果；部署时使用 digest。构建服务账号只需目标仓库写权限及构建日志、暂存对象所需权限，不应取得 R2、数据库或 Provider Secret。

## 环境变量与 Secret

API 与 Worker 必须指向同一数据库、同一私有 R2 bucket，保持 `PROCESSING_PROVIDER`、`PROCESSING_PRICE_VERSION` 一致。新链路开关独立于旧 `WATERMARK_PROVIDER`。

| 配置 | API | Worker | 说明 |
| --- | --- | --- | --- |
| `DATABASE_URL` | 必需 | 必需 | 同一金融账本与 outbox；数据库 Secret |
| `R2_ENDPOINT` 或 `R2_ACCOUNT_ID` | 必需 | 必需 | 同一 R2 账户与私有 bucket |
| `R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY` | 必需 | 必需 | 仅服务端；至少允许该 bucket 的对象读、写、复制、删除、列举 |
| `R2_BUCKET` | 必需 | 必需 | 默认 `watermark`，生产明确填写 |
| `PROCESSING_ENABLED` | 必需 | 必需 | 默认 `false`；显式 `true` 才开放新操作能力 |
| `PROCESSING_PROVIDER` | 必需 | 必需 | 生产为 `dewatermark`；默认 `mock`，模拟结果不得作为真实去水印验收 |
| `DEWATERMARK_API_KEY` | 真实链路必需 | 真实链路必需 | 从服务端 Secret 注入；不放进构建参数或浏览器 |
| `PROCESSING_PRICE_VERSION` | 必需 | 必需 | 默认 `processing-v1`；更改价格版本会使旧报价需重新确认 |
| `FFPROBE_PATH` | 可不设 | 视频必需 | 镜像已设 `/usr/bin/ffprobe`；本地用注入的绝对路径 |
| `GOOGLE_CLOUD_PROJECT`、`CLOUD_RUN_REGION`、`CLOUD_RUN_JOB` | 投递必需 | `dispatch` 必需 | 目标项目、区域、Job；项目支持 `GCP_PROJECT_ID` 别名。Cloud Run 自动注入保留变量 `CLOUD_RUN_JOB`，部署 Worker 时不要在 env 文件重复设置；Vercel API 端需显式配置 |
| `GOOGLE_CLOUD_PROJECT_NUMBER` | 建议 | 建议 | 数字编号，用于识别云返回的执行引用；支持 `GCP_PROJECT_NUMBER` 别名 |
| `CLOUD_RUN_CONTAINER` | 必需 | 必需 | 默认 `worker`，必须与真实容器名一致 |
| `WORKER_MAX_RUN_MS`、`WORKER_POLL_MS` | 不需要 | 可选 | 默认 900000、5000；受限正整数，不形成无限轮询 |

API 沿用现有 Google 登录、`BETTER_AUTH_URL` 和认证 Secret；Worker 不加载登录回调。`JOB_ID`、`OWNER_ID` 与 `DISPATCH_ID` 来自已授权投递的执行覆盖，不设为共享固定值。当前 SDK 固定使用官方 `platform.dewatermark.ai`，新链路不读取旧接口的 `DEWATERMARK_BASE_URL`、`DEWATERMARK_PREDICT_MODE`、`DEWATERMARK_TIMEOUT_MS`。

Worker 的数据库连接串、R2 两项凭据、Provider Key 使用 Secret Manager 环境变量绑定，并固定 Secret 版本。Cloud Run 环境变量 Secret 在容器启动前解析，运行身份需具备对应 Secret 的 `roles/secretmanager.secretAccessor`；不要将明文写进 YAML 或命令参数。[Cloud Run Job Secret](https://docs.cloud.google.com/run/docs/configuring/jobs/secrets)

预签名 PUT 在签名时尚无文件 Body，应避免 SDK 把空内容 CRC32 固定到上传链接。新处理链路的 S3 client 使用 `requestChecksumCalculation: 'WHEN_REQUIRED'`；发布回归检查真实离线签名没有空内容校验参数，完整性仍由预检的真实字节、SHA256、尺寸与类型验证负责。不要事后修改已签名 URL 的参数。[AWS 校验配置](https://docs.aws.amazon.com/sdkref/latest/guide/feature-dataintegrity.html)

## Vercel 到 GCP 的短期身份

Vercel 服务端使用官方 `@vercel/oidc` + `google-auth-library` 外部身份模式；GCP Worker 使用附加服务账号的 ADC。两边都不需要新建长期服务账号私钥。Vercel 端配置：

```text
GCP_PROJECT_NUMBER
GCP_SERVICE_ACCOUNT_EMAIL
GCP_WORKLOAD_IDENTITY_POOL_ID
GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID
```

目标项目 ID、区域、Job 按上表填写；数字项目编号也可使用 `GOOGLE_CLOUD_PROJECT_NUMBER`。四项身份配置必须完整，部分配置会拒绝启动投递，完整联邦配置优先于旧私钥兼容入口。

GCP OIDC provider 使用实际 Vercel issuer 模式：team 模式为 `https://oidc.vercel.com/TEAM_SLUG`，并映射 `google.subject=assertion.sub`。信任条件或受限 subject 应锁定目标 team、project 和 production 环境，不能让任意团队或 Preview 获得生产身份。仅对该受限主体授予目标服务账号的 Workload Identity User 权限。[Vercel 官方 GCP 接入](https://vercel.com/docs/oidc/gcp)

本代码采用官方 **custom audience** 示例。GCP provider 选择 **Default audience**，subject token 与 STS 配置使用同一个完整地址：

```text
https://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/providers/PROVIDER_ID
```

`GCP_AUDIENCE` 可省略，代码按配置生成；填写时必须精确等于该地址。只允许 `https://vercel.com/TEAM_SLUG` 的旧 Allowed audiences 配置与本模式不匹配。不要为了“等价”写法改动官方初始化对象或 subject token supplier。Token 在请求需要时获取，模块加载、构建和普通公开页面不取 Token。

Cloud Run 环境中不配置 Vercel 的三项联邦身份字段，也不配置 `GOOGLE_SERVICE_ACCOUNT_JSON`、`GOOGLE_APPLICATION_CREDENTIALS`；使用明确附加的运行服务账号。轮换身份或 Secret 时，先验证对应短期访问与新执行的实际信号，再停用旧入口。

## IAM 与 Job 参数

适配器调用 `jobs:run` 时覆盖 `MODE`、`JOB_ID`、`OWNER_ID`、`DISPATCH_ID`，并监控 execution / operation。`roles/run.invoker` 单独不足以完成该投递。生产可按下表配置；自定义角色可收窄读权限，但不能遗漏恢复所需查询。[Cloud Run IAM 角色](https://docs.cloud.google.com/run/docs/reference/iam/roles)

| 身份 | 权限范围 |
| --- | --- |
| Vercel 联邦所模拟的调用账号 | 目标 Job 的 `roles/run.jobsExecutorWithOverrides`；`run.executions.get`、`run.executions.list`、`run.operations.get` 读权限。可按实际资源层级配 `roles/run.viewer` 或等价自定义角色 |
| Worker 运行账号 | 对绑定 Secret 的 Secret Accessor；采用同一 Job 执行 `dispatch` 时，还需与上行相同的启动与监控权限 |
| Scheduler 调用账号 | 仅启动默认 `dispatch` 的目标 Job，可用该 Job 上的 `roles/run.invoker`，不需要环境覆盖权限 |
| 发布账号 | 镜像读取/部署 Job、使用运行服务账号和绑定配置所需权限；不把发布权限授予 Web 调用账号 |

建议初始执行设置：1 个 task、并行度 1、平台自动重试 0、20 分钟 task timeout、Worker 本地循环 15 分钟；CPU/内存起始配置 1 CPU / 2 GiB，按真实样本观测调整。这是本站配置起点，不是供应商限制或已完成的性能结论。耐久 outbox 负责进程退出后的恢复，不能依赖容器自动重试替代业务恢复。[Job 参数](https://docs.cloud.google.com/sdk/gcloud/reference/run/jobs/create)、[任务超时](https://docs.cloud.google.com/run/docs/configuring/task-timeout)

`parallelism` 约束单次 execution 的 task 并行度，不限制多个 execution 的总并发。当前每次 dispatcher 最多认领 10 条 outbox；生产容量还应观察同时运行的 execution、数据库连接和供应商配额，不能把 `parallelism=1` 当作全站一次只处理一个任务。

部署模板中的 `WORKER_ENV_FILE` 仅包含上表非敏感值；Secret 名称、版本由发布负责人替换：

```text
gcloud run jobs deploy WORKER_JOB --project=PROJECT_ID --region=REGION --service-account=WORKER_SERVICE_ACCOUNT_EMAIL --tasks=1 --parallelism=1 --max-retries=0 --task-timeout=1200s --container=worker --image=IMAGE_DIGEST --cpu=1 --memory=2Gi --env-vars-file=WORKER_ENV_FILE --set-secrets=DATABASE_URL=DATABASE_SECRET:VERSION,R2_ACCESS_KEY_ID=R2_ACCESS_SECRET:VERSION,R2_SECRET_ACCESS_KEY=R2_SECRET:VERSION,DEWATERMARK_API_KEY=PROVIDER_SECRET:VERSION
```

容器默认 `MODE=dispatch`。上线时确认实际模板容器名确为 `worker`，否则 API 覆盖会被拒绝。不要加 `--execute-now` 试探；先验证无收费的配置与调度信号。生产网络需能访问数据库、私有 R2、官方 API、已核实的供应商存储和 Google 身份/Run API，不能将 ffprobe 输入协议放宽到远程网络。

## 周期恢复与已核实契约

必须配置周期 `dispatch`，建议每分钟执行一次。周期执行只投递或恢复已被用户确认的操作，不创建新报价或新收费 job。Cloud Scheduler 调用 `https://run.googleapis.com/v2/projects/PROJECT_ID/locations/REGION/jobs/WORKER_JOB:run`，HTTP POST，body `{}`，使用 **OAuth** 服务账号访问令牌；Google API 目标应使用 `--oauth-service-account-email`。Cloud Run Service 的 OIDC 配法不适用于此 Job API。[Job 定时执行](https://docs.cloud.google.com/run/docs/execute/jobs-on-schedule)、[HTTP 目标身份](https://docs.cloud.google.com/scheduler/docs/http-target-auth)

| 项目 | 当前实际实现与边界 |
| --- | --- |
| 图片普通 / PRO | 正确区分官方端点；结果统一 JPEG、透明区域铺白，保留供应商实际输出尺寸；报价前限制最长边不超过 6000 px |
| 图片精修 | 当前结果 JPEG + 该结果的 session + 同尺寸 PNG `mask_brush`；不发送未明确的 `mask_base`；仅非 PRO 且最长边 ≤1920 px 的可用结果显示精修 |
| 图片上传 | JPEG/PNG/WebP，本站输入上限 10 MiB；真实解码、单帧、像素上限与方向信息检查 |
| 视频 | MP4、24 fps、最长 540 秒；本站上限 100 MiB；首期拒绝非零旋转元数据，不静默转码 |
| 视频固定选区 | 同源 artifact、同尺寸不透明黑白 PNG；移动水印跟踪未验证，不承诺支持 |
| 视频结果 | 保存前实际探测 MP4，并检查尺寸、时长和音轨存在性；音轨存在性检查不等于音频内容一致性或主观质量验收 |
| URL 信任 | 仅 HTTPS、精确域名、无非标准端口、无用户名密码、无 fragment、禁止跳转；签名查询保留且不写报告 |

2026-10-24 由发布负责人通过官方接口响应核实的存储域名如下，代码使用精确白名单，不允许 `*.bytepluses.com`：

```text
storage.googleapis.com
dewatermark-videos-asia-southeast1-prod.tos-ap-southeast-1.bytepluses.com
dewatermark-videos-result-asia-southeast1-prod.tos-ap-southeast-1.bytepluses.com
```

上述记录确认了域名与首次精修参数；不替代各操作的最终下载、质量和余额验收。供应商返回新域名时，保留既有 task ID，请发布负责人核实响应来源后增加精确域名；不要重新提交已完成的视频。

## 发布验收与恢复操作

### 媒体过期与控制记录

新媒体的目标配置是 `processing/staging/`、`processing/inputs/`、`processing/masks/`、`processing/results/` 四个精确前缀的一天 Expiration。脚本保留原桶规则，包括全桶七天终止未完成分片规则，不对 `processing/jobs/`、`quotes/`、`attempts/` 或其他恢复控制前缀增加 TTL。代码和 dry-run 就绪不代表生产规则已生效；只有 `applied_verified` 或独立读取确认后才能通过此门禁，应用前需明确授权对应的自动删除范围与保留期。

2026-10-24，经用户明确授权后，已对当前生产桶执行一次更新并回读验证：四项媒体规则均为 Enabled / Days 1，原全桶七天终止未完成分片规则保留，未给控制记录增加 TTL；配置写入 1 次，未写入或直接删除对象。原规则备份位于已忽略的 `output/r2-config/`。该配置验收不替代 Worker 部署与真实处理验收。

跨平台配置脚本默认只读预览；仅发布负责人在授权范围内使用 `--apply`：

```text
node scripts/processing-lifecycle.mjs
node scripts/processing-lifecycle.mjs --apply
```

CLI 在本地存在 `.env.local` 时加载该文件，凭据仅用于服务端调用；输出不含桶凭据、签名或规则 ID。应用前将完整原规则备份到已忽略的 `output/r2-config/`，随后只发一次配置 PUT 并读取核实。脚本不重试不明确的写入响应；遇 `apply_unknown` 或验证失败时，先重新只读检查，不直接重跑 apply。脚本不会写入或删除媒体对象。

一天表示创建/修改后达到过期条件，后台物理删除通常在到期后另一个 24 小时内进行，特殊情况可能更久；它不是“精确 24 小时物理删除”的保证。应用独立按 artifact 的期限停止预览和下载。[R2 生命周期行为](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)

金融恢复控制记录继续保留，防止尚处于 `UNKNOWN` 的任务先失去 R2 状态而无法归还已保留额度。新增 provider metadata、artifact 和 receipt 不再持久化未使用的 `maskBase`、`watermarkMask` 或相关 base64 遮罩内容；SDK 返回契约继续兼容。恢复较旧的含遮罩 receipt 时，重新写入的 private metadata 也只保留 session 和必要标识；旧的不可变 receipt 未被批量改写或删除。

session 仍支持结果有效期内的精修和恢复，四项媒体规则不会自动清除这些 JSON 内容。后续应在财务终态且对应 artifact 到期后，清理或擦除各 receipt、provider metadata、artifact/attempt 中的 session 副本，并处理旧诊断遮罩；该清理不能通过整个控制前缀的一天 TTL 替代。此项仍需独立实施和验证，不能以本次媒体生命周期已配置代替。

先完成项目要求的本地 `release:verify`、数据库迁移、Secret 绑定、私有 R2/CORS、短期身份和定时投递检查。R2 CORS 只放行实际应用 origin 的必要 PUT/GET/HEAD 与 Content-Type；浏览器拿不到桶或 Provider 凭据。确认 API 与 Worker 使用相同数据库/桶，金融迁移 `005_processing_pipeline.sql` 已由授权负责人应用。

公开检查不做真实处理：

```text
npm run test:smoke:production
npm run test:smoke:processing -- --base-url https://APP_ORIGIN
```

需要真实功能验收时，发布负责人从本机环境注入 `PROCESSING_ACCEPTANCE_SESSION_COOKIE`，显式指定 `--functional`、样本与已确认价格/单位。普通图片示例仅适用于报价确为 1 次免费额度的账号：

```text
npm run test:smoke:processing -- --functional --base-url https://APP_ORIGIN --operation image-watermark --sample "IMAGE_SAMPLE" --expected-amount 1 --expected-unit freeUses --image-limit 8
```

PRO / refine / video 分别使用 `image-watermark-pro`、`image-refine`、`video-watermark`；精修还需 `--parent-job`、`--parent-artifact`、`--mask`，视频本地探测需 `--ffprobe`。Cookie 不接受命令行参数，不能进入文档、报告或日志。

所有功能脚本与直连接口诊断共享 `output/acceptance/budget.json`。默认图片上限 5；本次获授权扩展到 8 时需显式 `--image-limit 8` 或 `PROCESSING_ACCEPTANCE_IMAGE_LIMIT=8`，视频仍最多 5。脚本在唯一的创建 job 请求前保留编号，失败和不明确结果也占用预算；预检不算收费请求。不得删账本、换路径或重新运行来绕开预算。

验收应留存脱敏 record ID、任务 ID、实际格式/尺寸/时长/音轨信息、报价单位及扣费前后数值，并确认只扣一次。脚本返回 `UNKNOWN`、请求超时或断开后，先按已保存任务与操作键恢复，禁止重复 POST。`READY` 还需实际下载、播放和去水印效果人工检查；图片应检查精修前后版本，视频应检查同步预览、声音与输出。

暂时关闭 `PROCESSING_ENABLED` 会关闭新操作能力；它不删除已保留的任务和账本。若需停止新供应商调用，发布负责人同时控制 dispatcher / 云投递，并保留已有 attempt 和 receipt 供恢复；不要手工清空状态来“重跑”。已受理任务的取消或超时不能被当作未收费的证据。

生产报告分别记录：代码验证、仓库/PR、应用部署、Worker 镜像/执行、域名证书、登录、R2/CORS、真实 Provider 输出与余额。适用门禁尚未通过时，不将其写为已完成。
