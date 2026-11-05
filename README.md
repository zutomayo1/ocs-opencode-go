# OCS 题库配置 · OpenCode Go

用 OpenCode Go 的模型当 OCS 的「题库」：把每道题连同选项发给模型，让模型只回一个 JSON，再翻译成 OCS 认得的答案格式。

- 交付物：`config.json` —— 整份数组粘进 OCS 的「题库配置」即可
- 目标环境：**OCS 客户端软件**（`type: "fetch"`）
- 默认模型：`deepseek-v4.1-flash`
- 状态：离线自检 38 项全过（`node test/validate.mjs`），联网实测 8 种题型全中，平均 **~2.1 秒/题**

---

## 1. 三步接入

### ① 拿 Go 的 key

1. <https://opencode.ai/console> 订阅 **Go / Go Plus**（$10 / $40 每月，这是 Go 不是按量的 Console 余额）
2. **Account → Personal API keys → Add API key**，指定一个有 Go 订阅的 workspace，复制 `oc_sk_...`（只显示一次）

> `*-free` 系列模型在非 OpenCode 客户端一律 403，所以只能用 Go 清单里的付费模型。

### ② 把 key 填进去

两种都行：

```powershell
# 方式一：环境变量（推荐，key 不落进 build.mjs）
$env:OC_API_KEY = "oc_sk_xxx"
node build.mjs

# 方式二：把 key 写进 build.mjs 的 CONFIG.apiKey，再 node build.mjs
```

也可以直接打开 `config.json`，把 `oc_sk_REPLACE_ME` 换成你的 key（顺手把 `x-opencode-session` 的 `ses_ocsgo_...` 改成你自己的随机串，纯路由用，不影响功能）。

> 当前目录下的 `config.json` 已经用真实 key 生成过一份可直接用的版本。它是**明文密钥**，别提交、别外发；想还原成占位符，去掉 `OC_API_KEY` 环境变量再跑一次 `node build.mjs` 即可。

### ③ 粘进 OCS

OCS 设置面板 →「题库配置」→ 粘贴 `config.json` 的**整个数组** → 保存 → 随便找道题试一次。

如果模型选了 `deepseek-*` 并报 403，去 **Console → Settings → Privacy → Regions** 改成 **Global**（默认只放行「欧洲 & 美国」；没保存过地区设置的 workspace 对来自中国的请求也放行 Global，所以有可能直接可用——本次实测就是直接通的）。

---

## 2. 这份配置到底在干什么

```
OCS 拿到题目 ──> data.messages.handler(env) 拼 messages
              ──> POST https://opencode.ai/inference/go/openai/v1/chat/completions
              ──> handler(res) 解析 choices[0].message.content
              ──> 返回 [undefined, "A"] ──> OCS 用字母点选项
```

几个不这么写就会翻车的点：

| 做法 | 原因 |
| --- | --- |
| `data.messages` 写成 `{ handler }` | OCS 只对 `data` 的**第一层**字段做 handler 解析，嵌套对象里的 handler 不会被调用 |
| 必须带 `x-opencode-session` | 缺了直接 `400 MissingSessionID`，实测不是可选头 |
| 单选/多选回**字母**（`A` / `AC`） | OCS 对纯 ABCD 答案有专门的兜底分支，字母比让模型复述选项原文稳得多 |
| 判断题回**选项原文**（`对` / `正确`） | OCS 的判断题算法是拿答案去跟选项做关键词等值比较，回字母（`A`）永远匹配不上 |
| 判断题 / 填空题用 `kind:"text"` | 避免把 `HTML` 这种纯字母答案当成选项字母去排序 |
| 题目字段回 `undefined` | OCS 会自己显示搜到的题目，不用重复传 |
| 置信度不够时 `return undefined` | 整条 wrapper 不产出结果 → OCS 记为未找到。**千万别回 `[msg, undefined]`**，答案位允许 `undefined` 会让下游匹配抛错 |

---

## 3. 换模型

只改 `build.mjs` 的 `model`（`name` 会自动跟着变），重跑 `node build.mjs`。Go 清单里适合答题的：

| model id | 月额度 | 备注 |
| --- | --- | --- |
| `deepseek-v4.1-flash` | $100 | 默认。中文强、额度最高，**必须先开 Global 地区** |
| `glm-5.3-flash` | $60 | 不用改地区，中文稳，速度快，性价比首选 |
| `glm-5.3` / `glm-5.2` | $15 / $60 | 更强，但慢一些 |
| `qwen3.8-flash` | $30 | 中文题感好 |
| `gpt-6-luna` | $15 | 最快最便宜那档 |
| `mimo-v2.6-flash` / `longcat-2.0` | $60 | 额度大，延迟低 |
| `kimi-k3` / `kimi-k3.1-pro` | $15 | 长文本强，答题用不上 |
| `minimax-m3` | $60 | — |

注意 OCS 的超时是**写死的 60 秒**（`AnswerWrapperHandlerConfig.timeout_seconds`，题库配置改不了）。所有模型都走 `/openai/v1/chat/completions`，Console 会帮你翻译协议，换模型不用改 url。

`deepseek-v4.1-flash` 实测 8 种题型平均 **2.1 秒**、最慢 2.9 秒，离 60 秒还有很大余量：

```
✓ 单选·常识        1788ms  A      → A. 有机物和氧气
✓ 单选·毛概        2312ms  B      → B. 中国共产党领导
✓ 多选            2360ms  BCD    → B/C/D 三项全中
✓ 判断·对错        1921ms  对      → A. 对
✓ 判断·正确/错误    1977ms  错误    → B. 错误
✓ 填空·单空        2381ms  H2O    → H2O
✓ 填空·双空        1520ms  叶绿体#氧气 → 拆成两个空
✓ 不会的题         2850ms  （置信度 0.1，主动弃答）
```

改完模型可以随时复跑这组测试：

```powershell
$env:OC_API_KEY = "oc_sk_xxx"
node test/live.mjs                 # 单题冒烟，看状态码+耗时
node test/live-matrix.mjs          # 8 种题型矩阵，用 config.json 里的模型
node test/live-matrix.mjs glm-5.3-flash   # 临时试别的模型
```

---

## 4. 常见报错

响应体里 `error.message` 会打到控制台（`[OCS/OpenCode]` 前缀），对着看：

| 现象 | 原因 |
| --- | --- |
| `400 MissingSessionID` | `x-opencode-session` 被删了 |
| `401 Invalid credential` | key 错/过期，或者这个 key 不属于有 Go 订阅的 workspace |
| `403` | 用了 `*-free` 模型（非 OpenCode 客户端不给）、模型不在 Go 清单、或地区没开（DeepSeek 默认只放行欧洲&美国） |
| `429` | 当月额度用完；可去 Console 打开 Extra Usage 兜底到按量余额 |
| 请求 60 秒超时 | 模型太慢，换 `gpt-6-luna` / `glm-5.3-flash` / `mimo-v2.6-flash` |
| `Failed to fetch` / 跨域 | 见下一节 |

### 如果软件里报跨域

OpenCode 的网关**没有 CORS 头**（实测 `OPTIONS` 预检直接 404，响应里没有 `Access-Control-Allow-Origin`），所以纯浏览器 `fetch` 是走不通的。客户端软件通常关掉了 `webSecurity` 才能用 `fetch`；万一你这个版本没关：

1. 首选：改用油猴 / 脚本猫加载脚本版，把 `build.mjs` 里 `requestType` 改成 `GM_xmlhttpRequest`，重跑构建；同时脚本头部必须加 `@connect opencode.ai`（否则 Tampermonkey 照样拦），或者直接装官方的「全域名通用版本」。
2. 次选：本地起一个反代（Caddy/Nginx 加 CORS 头），把 `url` 指向 `http://127.0.0.1:xxxx/openai/v1/chat/completions`。

---

## 5. 调参

- **置信度阈值**：`src/handler.response.js` 的 `MIN_CONFIDENCE`（当前 `0.5`）。调高 → 更多题被跳过；调成 `0` → 有答案就填。
- **提示词**：`src/handler.messages.js`。想让模型更保守/更敢猜，改那句「没把握就给低分」即可。
- **输出长度**：`build.mjs` 的 `maxTokens`（当前 `512`），答题用不上更长的。
- 改完任何 `src/*.js` 都要 `node build.mjs` 重新生成，**不要手改 `config.json`**（handler 是「字符串里的 JS」，手改转义必翻车）。

---

## 6. 已知限制

- 一道题 = 一次真实请求，OCS 这层没有缓存钩子可插，**没有去重/缓存**，重复的题会重复计费。
- 单轮问答，不带上下文；同一门课的相邻题目不会互相参考。
- 多选题字母只认 `A`–`J`（超过 10 个选项的题会漏）。
- 判断题完全依赖模型「照抄选项原文」。模型如果只回字母，这道题会记为未找到——这是有意的取舍，宁可空着也不乱填。
- 填空题多空用 `#` 连接，这是 OCS 自己拆分隔符的规则。
- 答案对不对取决于模型。建议先小批量跑一门课看准确率，再决定要不要放开。

> 合规提醒：Go 的文档写明它是给 coding agent 用的、有滥用监控，拿它当通用问答/答题器不属于设计用途，被限流或封号的风险需要自己权衡；要长期跑，按量付费的 Console 模型可能更省心。

---

## 7. 文件说明

```
ocs-opencode-go/
├─ config.json              # ← 交付物，整份粘进 OCS
├─ build.mjs                # 由 src + key 生成 config.json（会自动自检能否编译）
├─ src/
│  ├─ handler.messages.js   # 题目 → messages（可读版本，改这个）
│  └─ handler.response.js   # 响应 → 答案（可读版本，改这个）
└─ test/
   ├─ ocs-match.mjs         # 从 OCS 4.0 源码搬来的答案匹配算法，用来验证"OCS 真的会选中它"
   ├─ validate.mjs          # 离线自检：38 项
   ├─ live.mjs              # 联网冒烟：真打一次 API，看状态码和耗时
   └─ live-matrix.mjs       # 联网矩阵：单选/多选/判断/填空/不会的题 各跑一遍
```
