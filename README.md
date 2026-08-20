# 拾光成长

面向职场人的轻量成长 Web App：每日自律、认知、口才、情绪微任务，AI 成长助手，以及基于科大讯飞 ISE 的浏览器录音评分。

本分支将原有微信/演示登录替换为**邮箱注册与登录**，并补充了可操作的隐私政策和数据权利入口。

## 已实现

- 每日任务、积分、勋章、成长画像、收藏、情绪记录与本机数据导出。
- **邮箱账号系统**：注册、登录、恢复会话、退出登录、失败限速、账号信息导出与删除账号。
- 密码使用 Node.js `scrypt` 加盐哈希；登录会话使用签名的 `HttpOnly`、`SameSite=Lax` Cookie，浏览器不保存密码或访问令牌。
- **隐私控制**：首次使用隐私同意；注册时单独同意；AI 内容处理默认关闭；“我的 → 隐私设置”可查看政策、导出与清除数据。
- AI 对话由服务端代理，第三方模型 API Key 不会下发至浏览器。
- 口才训练通过浏览器主动请求麦克风权限，上传 PCM 音频至 `/api/ai/speech-score`，由服务端调用讯飞 ISE。

## 数据边界

| 数据 | 用途与保存位置 |
|---|---|
| 邮箱、昵称、密码哈希、隐私同意 | 服务端账号认证；持久化在 `AUTH_DATA_FILE` |
| 会话 | 仅同源 `HttpOnly` Cookie，默认 14 天 |
| 任务、日记、画像、收藏等成长数据 | 当前版本只保存在用户浏览器的 `localStorage` |
| AI 对话内容 | 仅在用户主动开启“AI 内容处理”后发送给项目服务端和配置的模型服务商 |
| 录音 | 仅在用户开始录音后采集，用于本次讯飞语音评测请求 |

账号删除会清除服务端账号记录并退出登录；本机成长数据由用户单独导出或清除。

## 本地启动

```powershell
Copy-Item .env.example .env
npm install
npm start
```

本地 `http://127.0.0.1:8787` 开发时，请在 `.env` 中设置：

```env
AUTH_SECRET=替换为足够长的随机字符串
AUTH_COOKIE_SECURE=false
AUTH_DATA_FILE=./data/users.json
```

再按需填写 AI 和讯飞环境变量。基础检查：

```powershell
npm run check
```

## 邮箱验证与忘记密码

注册成功后，系统会向注册邮箱发送一次性验证链接；验证链接默认 24 小时有效。账号在验证前不能登录，但可以从登录页重新发送验证邮件。

登录页的“忘记密码”会发送一次性重置链接，默认 30 分钟有效。接口对未注册邮箱也返回相同提示，避免泄露账号是否存在；密码重置成功会使旧会话失效。

个人 QQ 邮箱使用以下生产配置：

```env
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=houzhenao_2007@qq.com
SMTP_PASS=QQ邮箱SMTP授权码
SMTP_FROM=拾光成长 <houzhenao_2007@qq.com>
APP_BASE_URL=https://你的Sealos公网域名
```

`SMTP_PASS` 必须是 QQ 邮箱生成的授权码，不能是 QQ 登录密码。不要提交这些值，也不要在聊天或截图中泄露授权码。

## 接口

| 方法与路径 | 说明 |
|---|---|
| `GET /api/health` | 运行状态、AI/讯飞配置状态 |
| `POST /api/auth/register` | 创建邮箱账号；必须携带当前隐私政策同意 |
| `POST /api/auth/login` | 邮箱密码登录；失败请求会限速 |
| `GET /api/auth/session` | 读取当前 Cookie 会话 |
| `POST /api/auth/logout` | 清除会话 Cookie |
| `GET /api/account/export` | 导出当前账号的服务端资料 |
| `DELETE /api/account` | 输入当前邮箱确认后删除账号 |
| `POST /api/ai/chat` | AI 成长助手 |
| `POST /api/ai/speech-score` | 讯飞语音评分（multipart/form-data） |

注册请求示例：

```json
{
  "email": "name@example.com",
  "displayName": "小光",
  "password": "Example123",
  "privacyAccepted": true,
  "privacyPolicyVersion": "2026-08-20"
}
```

## Sealos 部署（当前项目已配置自动镜像发布）

仓库的 `.github/workflows/deploy-sealos.yml` 会在 **`main` 分支**推送后构建镜像并更新现有 Sealos Deployment。合并邮箱登录功能前，请先完成以下生产配置：

1. 在 GitHub 仓库 Secrets 中新增 `AUTH_SECRET`，用密码管理器或 `openssl rand -base64 48` 生成；绝不能提交到仓库。
2. 在 Sealos 中为当前应用创建持久化存储并挂载到 **`/app/data`**。这一步是必须的：账号文件默认位于 `/app/data/users.json`，没有持久化卷时容器重建会丢失账号。
3. 确认 Deployment 环境变量包含：

   ```env
   NODE_ENV=production
   AUTH_SECRET=由 GitHub Secret 注入
   AUTH_DATA_FILE=/app/data/users.json
   AUTH_COOKIE_SECURE=true
   AUTH_SESSION_DAYS=14
   PRIVACY_POLICY_VERSION=2026-08-20
   ```

4. 保持副本数为 **1**。当前账号存储是小型单实例 JSON 文件库；多副本部署应先迁移到 PostgreSQL 等数据库。
5. 部署完成后访问线上 `/api/health`，确认返回 `emailLogin: true`，再通过浏览器注册一个测试账号并验证重启后仍可登录。

## 上线前必须补全

当前隐私政策覆盖已实现的功能范围，但对外正式运营前必须补充真实的：运营主体、联系邮箱、个人信息保护负责人、投诉渠道、实际 AI 服务商、数据保存期限和备份策略。

“忘记密码”和邮箱验证尚未实现，因为它们需要真实邮件服务、验证码存储和额外的风控机制。不要用假的“已发送邮件”流程替代；接入数据库与邮件服务后再上线相应功能。

## 安全要求

- 禁止提交 `.env`、`data/users.json`、任何 API Key 或 `AUTH_SECRET`。
- 生产环境未配置 `AUTH_SECRET` 时服务会拒绝启动，避免使用临时会话密钥。
- `AUTH_COOKIE_SECURE=true` 用于 HTTPS 公网域名；仅本地 HTTP 开发使用 `false`。
- 语音训练的讯飞凭据和 AI API Key 都只能存在于服务端环境变量中。
