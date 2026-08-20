# 拾光成长 · 原型交接说明

面向 22-40 岁职场人的轻量化成长 App 前端原型。每天 4 个微任务（每个 ≤5 分钟），整合**自律 · 认知 · 口才 · 情绪**四大模块。

---

## 一、文件说明

| 文件 | 说明 |
|---|---|
| `index.html` | 全部代码（HTML + CSS + JS 单文件，双击即可在浏览器打开） |
| `README.md` | 本交接说明 |
| 上级目录 `网页提取_QQ浏览器_20260815.docx` / `_extracted.txt` | 完整产品方案文档 |

---

## 二、当前进度（已完成）

- 首页仪表盘（成长指数、今日四任务、今日状态、四模块入口）
- 今日四任务（自律 / 认知 / 口才 / 情感自愈）：点「去完成」跳转到对应模块，模块内完成动作后自动打卡（+积分）
- 数据页：四维能力条形图 + 近 7 天积分折线图（全部真实计算，非写死）
- 个人中心：登录系统 + 20 枚可解锁勋章（解锁时弹窗鼓励 + 独立「勋章墙」页面，含进度条）+ 5 个二级板块（个人档案 / 收藏 / 报告 / 小组 / 隐私）
- **四大模块详情页**：
  - ⏱️ 极简自律：番茄专注计时（5/15/25 分钟 + 进度环）、2 分钟启动法专治拖延
  - 🧠 职场认知：今日认知 + 六维思维库（逻辑结构化 / 决策 / 反内耗 / 高效工作 / 升职晋升 / 人际破局）+ 收藏
  - 🎙️ 口才训练：1 分钟跟读 + 评分、结构化表达（总分总 / 结论先行）、6 场景话术库
  - 🌿 情绪自愈：情绪五选一记录 + 专属疏导、成长日记、反内耗知识库
- AI 成长助手（悬浮球对话）
- 微信登录（演示登录 + 微信接口预留，见「三·五」）
- 用户画像（首次进入引导填写岗位 / 年限 / 想提升方向）+ 个性化认知推送（按方向每天推）
- 浏览器录音通过 Web Audio API 采集，并根据实际 `AudioContext.sampleRate` 线性重采样为 16kHz、16-bit、单声道 PCM，再上传到 `/api/ai/speech-score`。

---

## 三、哪些是「模拟 / 待接真实 API」

| 功能 | 现状 | 要接什么 | 改哪里 |
|---|---|---|---|
| AI 成长助手 | 本地关键词规则库 `aiKB` | 大模型（DeepSeek / 通义 / 智谱 / OpenAI…） | `AI_CONFIG.chat` |
| 口才跟读评分 | 随机模拟分数 | 讯飞口语评测 / 自建语音评分 | `AI_CONFIG.speechScore` + `scoreSpeech()` |
| 语音情绪识别 | 未实现（P2） | 情感分析 API | `AI_CONFIG.emotionVoice`（预留） |
| 微信登录 | 演示登录（本地假登录） | 微信 OAuth（需后端 + AppID） | `AUTH_CONFIG` + `wxLogin()` |

---

## 三·五、微信登录怎么接（预留）

当前是**演示登录**（本地假登录，随机昵称，存 `localStorage` 的 `sg_user`），跑通完整登录流程：登录 → 界面显示昵称/头像 → 退出。

接真实微信登录三步：

1. 搜索 **`AUTH_CONFIG`**，把 `enabled` 改 `true`，填 `appId`、`backendUrl`，选 `mode`（`web` 网站扫码 / `mp` 小程序 / `app` App）。
2. 实现 **`getWxCode()`** 函数：按 mode 拿到一次性 `code`（网站扫码跳开放平台二维码、小程序用 `wx.login`、App 用 SDK）。
3. 写一个后端接口 `POST backendUrl`，入参 `{ code }`，后端用 **AppSecret** 换 `openid` 并返回 `{ nick, avatar, openid }`。

> ⚠️ `AppSecret` 只能放后端，永远不要放前端。后端可用微信云开发 / 云函数 / 任意 Serverless。
> 资质要求：网站扫码需「网站应用」（企业认证）；小程序个人可注册；App 需「移动应用」。

---

## 四、怎么接真实 AI（安全服务端代理）

项目已经接入真实 AI：浏览器只请求本项目的 `POST /api/ai/chat`，不会直连第三方模型，也不会接触供应商 API key。

1. 安装 Node.js 18+。
2. 复制 `.env.example` 为 `.env`。
3. 只在 `.env` 中填写服务商配置：

```env
AI_BASE_URL=https://api.deepseek.com/v1
AI_MODEL=deepseek-chat
AI_API_KEY=你的真实Key
PORT=8787
```

4. 启动：`npm start`。
5. 打开 `http://127.0.0.1:8787`，进入 AI 成长助手测试。

接口：`GET /api/health` 只返回运行状态和模型名；`POST /api/ai/chat` 接收 `{ "message": "你的职场问题" }`，返回 `point/script/avoid`。

支持 OpenAI 兼容接口。切换供应商时只修改 `.env` 的 `AI_BASE_URL` 与 `AI_MODEL`，不要修改前端或把 key 写入 `index.html`。

## 五、科大讯飞口语评测接入

口才训练已支持浏览器录音并通过服务端调用科大讯飞 ISE 语音评测。浏览器不会接触讯飞凭据。

在 `.env` 中填写讯飞控制台获取的三项配置：

```env
IFLYTEK_APP_ID=你的AppID
IFLYTEK_API_KEY=你的APIKey
IFLYTEK_API_SECRET=你的APISecret
IFLYTEK_TIMEOUT_MS=45000
MAX_AUDIO_BYTES=10485760
```

启动服务：

```bash
npm install
npm start
```

打开 `http://127.0.0.1:8787`，进入「口才训练」，点击「开始跟读」，说完后点击「停止并评测」。流程为：

```text
浏览器 MediaRecorder（audio/webm/opus）
→ POST /api/ai/speech-score
→ 服务端调用讯飞 ISE WebSocket
→ 返回语速、流畅度、完整度、发音等评分
```

接口使用 `multipart/form-data`，字段如下：

- `audio`：录音文件
- `targetText`：跟读目标文本
- `durationMs`：录音时长

> 前端已直接采集 16kHz、16-bit、单声道 PCM（`audio/L16;rate=16000`），服务端无需 FFmpeg 转码。讯飞返回的评测结果为 Base64 编码 XML，服务端使用 XML parser 解码后映射为评分字段。不要把 AppID、APIKey、APISecret 写入 `index.html`。

官方文档参考：[讯飞语音评测（流式版）API 文档](https://shandong.xfyun.cn/doc/Ise/IseAPI.html)



- **绝对不要**把真实 key 写入 `index.html`、localStorage、前端请求头、README、截图、聊天记录或 Git。
- `.env` 已加入 `.gitignore`，只提交 `.env.example`。
- 服务端日志不会打印请求内容或 API key；对外错误只返回通用错误信息。
- 如果 key 曾出现在前端、Git 历史、公开仓库或聊天中，请立即撤销并重新生成。
- 生产部署时把 `AI_API_KEY` 配置为平台 Secret，并增加域名白名单、限流和鉴权。

## 六、目前仍为预留/模拟的功能

| 功能 | 现状 | 后续接入 |
|---|---|---|
| 口才跟读评分 | 随机模拟分数 | 通过服务端 `/api/ai/speech-score` 接讯飞或自建语音服务 |
| 语音情绪识别 | 未实现（P2） | 情感分析 API |
| 微信登录 | 演示登录 | 微信 OAuth（需后端 + AppID） |

> 讯飞 `appId` / `apiKey` / `apiSecret` 同样只能放服务端，不能填回前端。

---

## 七、微信登录怎么接（预留）

当前是演示登录。真实微信登录需要前端获取一次性 `code`，再由后端使用 AppSecret 换取用户信息；AppSecret 只能放后端。

---

## 八、口才评分与其他待办

1. 口才评分当前仍是随机模拟分数；后续应由浏览器采集音频并上传到后端 `/api/ai/speech-score`，讯飞凭据只能放服务端。
2. 语音情绪识别尚未实现。
3. 统计同步、学习小组等功能仍使用本地数据或占位实现。

---

## 九、建议的后续开发顺序

1. 把 `statStore` 本地统计换成后端接口（Firestore 或任意后端），实现多端同步
2. 接真实微信登录（见「三·五」）
3. AI 助手接真实大模型（走你自己的后端代理，见安全提醒）
4. 口才跟读真实录音 + 讯飞评分
5. 成长报告做成分享长图（方案里的 P1 加分项，现已有文字版周报）
6. 学习小组 / 企业版看板（P2，现已有占位页）

---

## 九、技术备注

- 运行方式：使用 `npm start` 启动 `server.js`，由服务端同时提供 `index.html` 和安全 AI 代理；不要直接双击 HTML 测试真实 AI。
- 数据模型集中在 `state` 对象（约 index.html 中段），迁移后端时从它入手。
- 真实统计层：搜索 `statStore` / `addPoints` / `dimScore` / `weeklyData`，所有积分与能力值从这里动态计算。
- 本地存储的 key 前缀为 `sg_`：`sg_stats`（累计统计）、`sg_tasks`（当天完成）、`sg_user`（登录态）、`sg_profile`（用户画像）、`sg_badges`（已解锁勋章）、`sg_cog_log`（认知抽取记录）、`sg_cog_favs`、`sg_emotion_today`、`sg_diary`。
- 登录相关代码集中在 `index.html` 搜索 `AUTH_CONFIG`、`wxLogin`、`demoLogin`、`applyUser`。
- 用户画像与个性化推送：搜索 `getProfile` / `openOnboarding` / `saveProfile` / `todayCog`（`todayCog` 按「想提升方向」的分类过滤每日认知）。
- 认知内容库：搜索 `cognitionCategories`（通用 6 大分类）与 `roleItems`（岗位专属，`role` 匹配画像里的岗位，`todayCog` 优先抽它实现「不同岗位推不同内容」）。每条含 title/concept/case/use/avoid。「每天随机不重复」由 `todayCog` + `sg_cog_log` 实现——加新内容只需往对应数组加一条对象即可。
- 勋章系统：搜索 `BADGES`（20 枚勋章，`test` 用真实数据判断解锁条件、`prog` 返回 `{cur,target}` 供进度条展示）、`checkBadges`、`renderBadges`、`showNextBadge`、`openBadgePage`（独立「勋章墙」页面）。每次加分后自动检测，新解锁的勋章逐个弹窗鼓励。
- 二级面板（个人档案 / 收藏 / 报告）搜索 `openPanel`、`openProfilePanel`、`openFavPanel`、`openReportPanel`。
