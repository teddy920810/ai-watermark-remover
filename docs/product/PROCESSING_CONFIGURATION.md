# 新处理链路配置

旧图片配置与新处理配置分开。生产沿用原正式项目的认证、数据库和存储配置；新设置默认关闭，不在源码、浏览器或 Git 保存真实凭据。完整必需配置、短期身份和 Secret 绑定见 [Worker 部署说明](WORKER_DEPLOYMENT.md)，首发路由与资源兼容见 [独立部署说明](../../apps/DEPLOYMENT_TARGETS.md)。

下面是无凭据的配置名称示例，应在服务端安全配置，不作为自动启用新处理的脚本：

```text
PROCESSING_ENABLED=false
PROCESSING_PROVIDER=mock
PROCESSING_PRICE_VERSION=processing-v1
GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID
GOOGLE_CLOUD_PROJECT_NUMBER=YOUR_PROJECT_NUMBER
CLOUD_RUN_REGION=YOUR_REGION
CLOUD_RUN_JOB=YOUR_JOB
CLOUD_RUN_CONTAINER=worker
GCP_SERVICE_ACCOUNT_EMAIL=YOUR_INVOKER_SERVICE_ACCOUNT
GCP_WORKLOAD_IDENTITY_POOL_ID=YOUR_POOL
GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID=YOUR_PROVIDER
APP_SITE_ORIGIN=https://YOUR_FIXED_SITE_PRODUCTION_ALIAS
LEGACY_ASSET_ORIGIN=https://YOUR_PREVIOUS_IMMUTABLE_COMBINED_DEPLOYMENT
```

Cloud Run 自动注入保留变量 `CLOUD_RUN_JOB`，因此 Worker 的部署 env 文件省略该变量；Vercel 服务端需显式配置它。Worker 使用附加服务身份的 ADC，不设置 Vercel 专用联邦变量。镜像自带 `/usr/bin/ffprobe`；本地媒体验收通过 `FFPROBE_PATH` 注入对应平台的路径。

本地、CI、预览和生产使用各自的配置。Vercel 中的处理开关必须与已部署 Worker 的 Provider 和价格版本一致。新能力只有在完整投递配置可用时才开放。启用真实处理前，完成迁移、R2 私有存储/CORS、Secret、短期身份、投递与已授权的功能验收。
