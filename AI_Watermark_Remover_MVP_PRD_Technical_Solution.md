# AI Watermark Remover MVP PRD & 技术方案

## 1. 项目目标

建设一个 SEO 驱动的 AI 图片去水印工具站。

第一阶段目标：

-   获取自然搜索流量
-   验证用户上传和处理需求
-   验证关键词价值
-   为后续接入真实 AI 去水印 API 做准备

技术方向：

-   Astro
-   React Islands
-   Vercel
-   Cloudflare R2
-   Mock Watermark API Provider

------------------------------------------------------------------------

# 2. 产品定位

## 产品名称

AI Watermark Remover

## 核心价值

Remove watermark from images online with AI technology.

用户上传图片，系统返回去除水印后的结果。

------------------------------------------------------------------------

# 3. MVP 功能范围

## P0 功能

### 图片上传

支持：

-   JPG
-   PNG
-   WEBP

限制：

-   最大 10MB
-   单图片处理
-   无需登录

### 图片处理流程

用户：

上传图片

↓

图片存储到 Cloudflare R2

↓

创建处理任务

↓

调用 Mock Watermark API

↓

返回处理结果

↓

下载图片

------------------------------------------------------------------------

# 4. SEO 页面规划

核心页面：

    /
     /watermark-remover

    /remove-gemini-watermark

    /ai-watermark-remover

    /remove-logo-from-image

    /remove-text-from-image

    /blog/*

目标：

覆盖：

-   watermark remover
-   remove watermark online
-   Gemini watermark remover
-   AI image watermark remover

------------------------------------------------------------------------

# 5. 技术架构

整体架构：

    User Browser

        |

    Astro + React

        |

    Vercel

        |

    ----------------

    |              |

    R2          API Layer

                  |

            Watermark Provider

                  |

            Mock / Real API

------------------------------------------------------------------------

# 6. 技术栈

Frontend:

-   Astro
-   React
-   TailwindCSS

Deployment:

-   Vercel

Storage:

-   Cloudflare R2

Backend:

-   Astro API Endpoint

------------------------------------------------------------------------

# 7. 图片存储设计

Cloudflare R2:

    bucket

    /uploads

    /results

生命周期：

上传文件：

24小时删除

结果文件：

24小时删除

------------------------------------------------------------------------

# 8. API设计

## 上传地址

POST

/api/upload-url

返回：

``` json
{
"url":"",
"key":"uploads/demo.png"
}
```

------------------------------------------------------------------------

## 创建任务

POST

/api/jobs

请求：

``` json
{
"inputKey":"uploads/demo.png"
}
```

返回：

``` json
{
"id":"job001",
"status":"processing"
}
```

------------------------------------------------------------------------

## 查询任务

GET

/api/jobs/{id}

返回：

``` json
{
"status":"completed",
"resultUrl":""
}
```

------------------------------------------------------------------------

# 9. Provider设计

不要绑定具体供应商。

结构：

    providers

    WatermarkProvider.ts

    MockProvider.ts

    RealProvider.ts

接口：

``` typescript
interface WatermarkProvider {

 remove(inputUrl:string):Promise<JobResult>

}
```

未来支持：

-   Replicate
-   第三方 AI API
-   自研模型

------------------------------------------------------------------------

# 10. SEO技术要求

所有页面必须包含：

-   title
-   description
-   canonical
-   OpenGraph
-   Schema

必须生成：

-   sitemap.xml
-   robots.txt

------------------------------------------------------------------------

# 11. Codex 开发规范

创建：

AGENTS.md

要求：

1.  SEO 页面必须使用 Astro 静态生成。

2.  交互功能使用 React Island。

3.  API Key 禁止暴露前端。

4.  图片必须存储 R2。

5.  Provider 必须抽象。

6.  提交前执行：

```{=html}
<!-- -->
```
    npm run lint

    npm run build

------------------------------------------------------------------------

# 12. 开发任务拆解

## Phase 1

基础工程：

-   Astro 初始化
-   Tailwind
-   Vercel配置
-   R2配置

## Phase 2

SEO 页面：

-   首页
-   场景页
-   Blog模板
-   FAQ

## Phase 3

上传组件：

-   拖拽上传
-   图片预览
-   上传R2

## Phase 4

Mock API：

-   upload-url
-   jobs
-   status
-   provider

## Phase 5

SEO优化：

-   Sitemap
-   Schema
-   内链

------------------------------------------------------------------------

# 13. 后续商业化路线

V1：

免费工具获取流量

V2：

接入真实 AI API：

-   登录
-   免费额度
-   历史记录

V3：

商业化：

-   Credits
-   Stripe/Lemon Squeezy
-   Batch processing
-   API

------------------------------------------------------------------------

# Codex任务描述

Build an SEO-first AI watermark remover website using Astro, React
islands, Vercel deployment and Cloudflare R2 storage.

Implement image upload workflow with mocked watermark removal API
provider.

Keep provider abstraction ready for future third-party AI API
integration.

Focus on SEO pages, fast performance, and clean architecture.
