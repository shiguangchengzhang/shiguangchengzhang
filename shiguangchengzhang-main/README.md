# 拾光成长开发文档

> 本文档以当前仓库代码为准，面向本地开发、功能联调、镜像构建和 Sealos 发布维护。

## 1. 项目概览

拾光成长是一个面向职场人的轻量成长 Web App，当前包含：

- 每日自律、认知、口才、情绪等成长任务；
- 积分、勋章、成长画像、收藏和情绪记录；
- 浏览器本地成长数据导出与清除；
- 邮箱注册、邮箱验证码验证、登录、会话恢复、退出和密码找回；
- AI 成长助手；
- AI 沟通实战陪练与对话评估；
- 基于科大讯飞 ISE 的浏览器录音评分。

项目采用“单 Node.js 服务 + 单页静态前端”的轻量架构：`server.js` 同时提供静态资源、账号接口和 AI/语音代理接口，`index.html` 作为前端入口。

## 2. 仓库结构

```text
.
├─ index.html                 # 单页前端及页面脚本、样式
├─ server.js                  # Node.js HTTP 服务、API、静态文件服务
├─ package.json               # 项目元数据与 npm 脚本
├─ package-lock.json          # 依赖锁定文件
├─ Dockerfile                 # 生产镜像构建文件
├─ .env.example               # 环境变量模板
├─ .github/workflows/
│  └─ deploy-sealos.yml       # main 分支自动构建、发布和线上检查
├─ README.md                  # 本开发文档
├─ CI-CD.md                   # Sealos CI/CD 操作说明
└─ data/users.json            # 运行时生成的账号库，不应提交到 Git
```

`node_modules/`、`.env` 和运行时账号文件属于本地或部署产物，不是业务源码。

## 3. 技术栈与运行方式

- Node.js 22（Docker 基础镜像为 `node:22.17.1-slim`）；
- Node.js 原生 `http` 服务，无 Express 等 Web 框架；
- `busboy`：解析语音评分的 `multipart/form-data`；
- `fast-xml-parser`：处理科大讯飞 ISE 返回数据；
- `nodemailer`：发送注册验证和密码重置邮件；
- `ws`：连接科大讯飞 ISE WebSocket 服务；
- 数据库：当前没有数据库，账号数据以 JSON 文件保存；
- 前端成长数据：当前保存在浏览器 `localStorage`。

## 4. 本地开发

### 4.1 环境要求

- Node.js 22 或兼容的现代 Node.js 版本；
- npm；
- 如需 AI 功能，需要可用的模型 API Key；
- 如需邮箱注册、验证和找回密码，需要 SMTP 服务；
- 如需口才评分，需要科大讯飞 ISE 凭据。

### 4.2 安装与启动

```powershell
Copy-Item .env.example .env
npm install
npm start
```

默认监听：`http://127.0.0.1:8787`。

本地 HTTP 开发至少建议设置：

```env
HOST=0.0.0.0
PORT=8787
AUTH_SECRET=一段足够长的随机字符串
AUTH_DATA_FILE=./data/users.json
AUTH_COOKIE_SECURE=false
APP_BASE_URL=http://127.0.0.1:8787
```

开发环境如果不配置 `AUTH_SECRET`，服务会使用随机临时密钥；重启后已有会话会失效。生产环境必须显式配置 `AUTH_SECRET`，否则服务直接退出。

### 4.3 基础检查

当前项目没有独立测试框架或测试目录，现有检查脚本只做 Node.js 语法检查：

```powershell
npm run check
```

等价于：`node --check server.js`。

启动后可检查健康接口：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/api/health
```

健康响应会报告 AI、讯飞、SMTP 是否配置，以及当前隐私政策版本和模型名。

## 5. 环境变量

完整模板见 [`.env.example`](.env.example)。敏感值只能放在本地环境、CI Secret 或 Sealos Secret/环境变量中。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `HOST` | `0.0.0.0` | HTTP 监听地址 |
| `PORT` | `8787` | HTTP 监听端口 |
| `CORS_ORIGINS` | 空 | 允许携带 Cookie 的前端源，多个值用逗号分隔；同源部署通常留空 |
| `AI_BASE_URL` | `https://api.deepseek.com/v1` | OpenAI 兼容模型服务地址 |
| `AI_MODEL` | `deepseek-chat` | AI 模型名 |
| `AI_API_KEY` | 空 | AI 服务密钥；仅服务端使用 |
| `AI_TEMPERATURE` | `0.7` | 模型温度 |
| `AI_TIMEOUT_MS` | `20000` | AI 请求超时 |
| `IFLYTEK_APP_ID`/`IFLYTEK_API_KEY`/`IFLYTEK_API_SECRET` | 空 | 科大讯飞凭据 |
| `IFLYTEK_TIMEOUT_MS` | `45000` | 语音请求超时 |
| `MAX_AUDIO_BYTES` | `10485760` | 音频上传大小上限，默认 10 MiB |
| `AUTH_SECRET` | 开发随机、生产必填 | 签名会话和验证码哈希密钥 |
| `AUTH_DATA_FILE` | `./data/users.json` | 账号 JSON 文件路径；容器中使用 `/app/data/users.json` |
| `AUTH_COOKIE_NAME` | `sg_session` | 会话 Cookie 名称 |
| `AUTH_SESSION_DAYS` | `14` | 会话有效天数，范围 1–90 |
| `AUTH_COOKIE_SECURE` | 生产 `true` | HTTPS 生产环境必须开启；本地 HTTP 设为 `false` |
| `PRIVACY_POLICY_VERSION` | `2026-08-20` | 注册时必须同意的隐私政策版本 |
| `SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE` | QQ SMTP 示例 | 邮件服务器配置 |
| `SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` | 空 | 发件账号、授权码和发件人 |
| `APP_BASE_URL` | 空 | 邮件和部署使用的公开地址 |
| `EMAIL_VERIFY_TTL_MINUTES` | `10` | 邮箱验证验证码有效期 |
| `PASSWORD_RESET_TTL_MINUTES` | `10` | 密码重置验证码有效期 |

QQ 邮箱的 `SMTP_PASS` 必须是 SMTP 授权码，不是 QQ 登录密码。

## 6. 架构与数据边界

### 6.1 请求流

```text
浏览器
  ├─ GET /                     → server.js 返回 index.html
  ├─ /api/auth/*               → 本地 JSON 账号库 + HttpOnly 会话 Cookie
  ├─ /api/ai/chat              → 服务端调用 AI Provider
  ├─ /api/ai/coach             → 服务端调用 AI Provider，生成陪练步骤/评估
  └─ /api/ai/speech-score      → 服务端通过 WebSocket 调用科大讯飞 ISE
```

AI Key、讯飞凭据和 SMTP 凭据不会下发到浏览器。

### 6.2 数据保存位置

| 数据 | 当前保存位置 |
|---|---|
| 邮箱、昵称、密码哈希、验证状态、隐私同意、重置记录 | 服务端 `AUTH_DATA_FILE` |
| 登录会话 | 签名的 `HttpOnly`、`SameSite=Lax` Cookie，默认 14 天 |
| 任务、积分、日记、画像、收藏、情绪等成长数据 | 用户浏览器 `localStorage` |
| AI 对话 | 仅在请求时转发到服务端和配置的模型服务商，不由当前服务持久化 |
| 录音 | 用户主动录音后上传，用于本次语音评测请求 |

密码使用 Node.js `scrypt` 加盐哈希。验证码只保存 HMAC 哈希，不保存明文验证码。登录失败、邮件发送和验证码尝试均有进程内限速；限速状态会在服务重启后清空。

### 6.3 当前架构限制

- JSON 账号库只适合单实例低并发运行；生产部署必须保持 `replicas: 1`；
- 账号文件必须使用持久化卷，否则容器重建会丢失账号；
- 多实例部署前应迁移到 PostgreSQL 等支持并发和事务的数据库；
- 进程内限速不适合多实例共享风控；
- 浏览器成长数据不会随服务端账号删除自动清除，用户需在前端单独导出或清除。

## 7. API 约定

### 健康检查

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/health` | 返回运行状态及 AI、讯飞、邮箱配置状态 |

### 账号与隐私

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/auth/register` | 创建账号并发送 6 位邮箱验证码；必须同意当前隐私政策 |
| `POST` | `/api/auth/verify-email` | 使用邮箱和 6 位验证码完成验证 |
| `POST` | `/api/auth/resend-verification` | 重新发送邮箱验证验证码 |
| `POST` | `/api/auth/login` | 邮箱密码登录，成功后写入会话 Cookie |
| `GET` | `/api/auth/session` | 读取当前会话 |
| `POST` | `/api/auth/logout` | 清除会话 Cookie |
| `POST` | `/api/auth/forgot-password` | 发送密码重置验证码，避免泄露邮箱是否注册 |
| `POST` | `/api/auth/reset-password` | 使用验证码设置新密码并使旧会话失效 |
| `GET` | `/api/account/export` | 导出当前账号的服务端资料 |
| `DELETE` | `/api/account` | 输入当前邮箱确认后删除账号 |

### AI 与语音

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/ai/chat` | AI 成长助手；`message` 长度为 1–4000 字符 |
| `POST` | `/api/ai/coach` | 沟通实战陪练；支持 `play` 和 `evaluate`，最多 6 轮 |
| `POST` | `/api/ai/speech-score` | `multipart/form-data` 语音评分；字段包括 `audio`、`targetText`、`durationMs`、`sampleRate` |

生产跨域请求必须命中 `CORS_ORIGINS`；使用 Cookie 时客户端需要 `credentials: include`。不要使用 `CORS_ORIGINS=*` 配合 Cookie 鉴权。

## 8. Docker

构建镜像：

```powershell
docker build -t shiguangchengzhang:local .
```

本地运行：

```powershell
docker run --rm -p 8787:8787 `
  -e NODE_ENV=production `
  -e AUTH_SECRET="替换为随机密钥" `
  -e AUTH_COOKIE_SECURE=false `
  -v "${PWD}/data:/app/data" `
  shiguangchengzhang:local
```

镜像以 UID/GID `10001` 的非 root 用户运行，暴露 `8787` 端口，并通过 `/api/health` 配置 Docker `HEALTHCHECK`。挂载 `/app/data` 时要确保该用户具有写权限。

## 9. Sealos 发布

### 9.1 自动发布流程

`.github/workflows/deploy-sealos.yml` 在 push 到 `main` 或手动执行 `workflow_dispatch` 时运行。工作流会构建 `linux/amd64` 镜像，推送 `hhnhhw/shiguangchengzhang:<commit-sha>` 和 `:main`，更新 `ns-8zpzccfm` 命名空间中的工作负载，注入账号、SMTP 和 AI 环境变量，等待 rollout，并检查线上 AI 接口与 `/api/health`。

当前线上地址：

```text
https://shiguangchengzhang-fxaethpl.sealosbja.site
```

### 9.2 GitHub Secrets

至少需要：`DOCKERHUB_USERNAME`、`DOCKERHUB_TOKEN`、`SEALOS_KUBECONFIG_B64`、`AUTH_SECRET`、`SMTP_USER`、`SMTP_PASS`、`SMTP_FROM`、`AI_BASE_URL`、`AI_MODEL`、`AI_API_KEY`。`AI_TEMPERATURE` 和 `AI_TIMEOUT_MS` 可选。

工作流会把账号文件设置为 `/app/data/users.json`，并将生产 Cookie 设置为 Secure。Sealos 必须挂载 `/app/data` 持久化卷，并保持单副本。

### 9.3 上线检查

```powershell
Invoke-RestMethod https://你的域名/api/health
```

确认 `emailLogin: true`、`emailConfigured: true`，并使用真实邮箱完成注册、验证码验证、登录、退出、重新登录和重启后持久化验证。录音功能必须通过 HTTPS 公网地址访问。

更完整的 Secrets、回滚和排障步骤见 [`CI-CD.md`](CI-CD.md)。

## 10. 安全与提交规范

- 禁止提交 `.env`、`data/users.json`、API Key、SMTP 授权码、`AUTH_SECRET` 和 kubeconfig；
- 生产环境必须显式设置 `AUTH_SECRET`；
- 生产环境使用 HTTPS，并设置 `AUTH_COOKIE_SECURE=true`；
- AI、讯飞和 SMTP 凭据只能保存在服务端环境变量或平台 Secret 中；
- 不要在日志、截图、Issue 或聊天中暴露密码、验证码、授权码和 Token；
- 修改账号、会话、验证码或上传限制后，至少执行 `npm run check`、健康检查和关键登录流程验证。

## 11. 常见问题

### 注册提示邮箱服务未配置

检查四个 SMTP 配置：`SMTP_HOST`、`SMTP_USER`、`SMTP_PASS`、`SMTP_FROM`。QQ 邮箱必须使用 SMTP 授权码。

### 公网登录后刷新即掉线

检查是否使用 HTTPS、`AUTH_COOKIE_SECURE=true`、域名未变化，以及反向代理是否传递 `Host` 和 `X-Forwarded-Proto`。

### 重启后账号消失

检查 Sealos 是否挂载 `/app/data` 持久化卷，`AUTH_DATA_FILE` 是否为 `/app/data/users.json`，并确认未使用多副本共享 JSON 文件。

### 录音功能无效

浏览器只允许在 HTTPS 或 localhost 环境使用麦克风。随后检查三个讯飞凭据、音频格式、采样率和 `MAX_AUDIO_BYTES`。

### AI 接口返回 503 或 502

先检查 `/api/health` 的 `configured` 字段，再检查 `AI_BASE_URL`、`AI_MODEL`、`AI_API_KEY`、网络连通性和上游服务额度。
