---
title: "SDD · 智能体连接配置 —— 类 ChatBox 的自定义端点 / 连接测试 / 模型列表"
type: design
status: draft
created: 2026-07-14
scope: frontend AgentPanel/IntentConfig + backend intent/连接探测（分支 TBD）
---

# SDD · 智能体连接配置（VLM 端点管理）

> **用途**：把当前 `IntentConfig`（后端二选一 + 单 key + 单 model 文本框）升级为**类 ChatBox / Cherry Studio 的连接管理**——支持自定义 `base_url`、**连接测试**、**拉取模型列表**下拉选择。让"自带智能体（自配 API/模型）"这条产品承诺（见 [README](../../README.zh-CN.md#为什么是-glaux)）从"只能填 Anthropic key"扩到"任意 OpenAI 兼容 / Anthropic 端点"。
> **日期**：2026-07-14 · **状态**：draft（待评审） · **依据**：[多模态架构](2026-07-07-glaux-multimodal-architecture.zh-CN.md) · 现状代码 `frontend/src/components/AgentPanel.tsx` / `backend/app/kernel.py` `ClaudeVLMBackend`
> **半衰期提醒**：Anthropic / OpenAI 的 `/v1/models` 契约、模型 id 命名（`claude-*`）、CORS/SSRF 边界策略可能漂移；动工前复核第 5、6 节。

---

## 0. 一页纸

**问题**：现在 VLM 意图后端只认 Anthropic 官方端点 + 单个 key + 手打 model 名（[AgentPanel.tsx:43-44](../../frontend/src/components/AgentPanel.tsx)）。用户无法：① 指向自建/代理/兼容网关（`base_url`）；② 在填完 key 后**验证连通**；③ **看到可用模型列表**再选，只能盲打 model 字符串。这对"自带智能体"是硬伤——绝大多数私有部署走 OpenAI 兼容网关。

**解法**：引入 **Connection（连接）** 一等概念——一条连接 = `{provider 类型, base_url, api_key, 选定 model}`。UI 从"二选一 radio"升级为"连接列表 + 连接编辑器"，编辑器内含 **测试连接** 与 **拉取模型** 两个动作；后端加两个薄探测端点，复用现有 `ClaudeVLMBackend` 的调用路径。

**范围（v0）**：单条 active 连接（不做多连接并存/切换轮询）；两类 provider——`anthropic`（现状）+ `openai_compatible`（新）；连接测试 = 一次 `GET /models` 或最小 ping；模型列表 = `GET /v1/models` 解析下拉，**全列 + 逐项标注视觉能力**（§9 决议）。`openai_compatible` **覆盖本地自部署**——Ollama（默认 `http://localhost:11434/v1`）、LM Studio（默认 `http://localhost:1234/v1`）都发 OpenAI 兼容契约，走同一条路径，仅 `base_url` 指向本机（**连接已运行的本地服务，不管理其进程**）。**不做**：多连接编排、每任务不同连接、密钥后端加密落库（v0 仍浏览器 localStorage + 可选后端 env）、非 HTTP 传输、**由 Glaux 拉起/守护本地推理进程**（Ollama/LM Studio 自身进程由用户启停）。

**不变量（沿用铁律）**：
- **意图后端可插拔无分支**——新 provider = 实现一个 `IntentBackend` 适配器 + 注册一行，不散落 if/else（同 `datasource_registry` / `TaskPlugin` 模式）。
- **密钥不入 git、不进日志、不进市场**（PHI/密钥红线；同 `store:corrections` 之外一切外发内容的既有约束）。
- **VLM 不可用要显式降级**——选了 VLM 但连接未通 → 明确 503 / UI 报错，**不静默退回 rule**（沿用 [api.py:105](../../backend/app/routers/api.py) 既有约定）。

---

## 1. 现状（改造起点）

| 层 | 现状 | 约束/接缝 |
|---|---|---|
| 前端 | `IntentConfig`：`rule`/`vlm` 二选一 radio + password key + model 文本框；key 存 `localStorage`（`vlmKey`/`vlmModel`，见 `store/session`） | 入口是 Agent 面板标题栏 `⚙ rule` / `✦ VLM` chip → `setCfgOpen` toggle（[AgentPanel.tsx:195-204](../../frontend/src/components/AgentPanel.tsx)） |
| 契约 | `InterpretRequest{ backend, api_key?, model? }`（[schemas.py:37-39](../../backend/app/schemas.py)）；`GET /intent/backends` 报可用性（[kernel.py:73-76](../../backend/app/kernel.py)） | `api_key` 可 UI 传入或服务端 env；无 `base_url` 字段 |
| 后端 | `ClaudeVLMBackend`（anthropic SDK）；`available()` 只查 `ANTHROPIC_API_KEY` env | 无"OpenAI 兼容"路径；无连接测试/模型列表端点 |

**缺口**：`base_url`（无）、连接测试（无）、模型列表（无）、provider 抽象（无，硬编 anthropic）。

## 2. 目标与用户故事

- **US-1**：作为自带模型的用户，我能新建一条连接，填 `base_url` + `api_key`，点**测试连接**，即时看到成功/失败与原因。
- **US-2**：连接通过后，我能点**拉取模型**，从真实返回的列表里下拉选一个（**列表全列，视觉可用的项带 👁 标注**），而不是盲打 model 名。
- **US-3**：我能在 `anthropic` 与 `openai_compatible` 两种 provider 间选择；选后 `base_url` 有合理默认（anthropic 官方 / 留空提示）。
- **US-5**：作为本地部署用户，我选 `openai_compatible` 后能一键填入 **Ollama / LM Studio** 的本机默认地址，无需记端口，连上我本地已跑起来的模型。
- **US-4**：切回 `rule` 后端时，连接配置保留不丢；重开面板仍在。

## 3. 交互设计

**入口不变**：Agent 面板标题栏 chip 仍是开关；chip 文案随 active 连接变（`✦ VLM · <model 简称>` / `⚙ rule`）。

**面板结构（替换现 `IntentConfig` 内容）**：

```
┌ 智能体 · 意图后端 ───────────────── ✕ ┐
│ ○ 规则（确定性关键词，不看图）          │
│ ● Claude VLM / 自定义端点               │
│ ┌───────── 连接 ─────────────────────┐ │
│ │ Provider  [ openai_compatible ▾ ]   │ │   ← anthropic | openai_compatible
│ │ 快填      ( Ollama )( LM Studio )    │ │   ← 仅 openai_compatible 显示，一键填本机地址
│ │ Base URL  [ http://localhost:11434/v1] │   ← 随 provider/快填 给默认/占位
│ │ API Key   [ (本地可留空) ]  仅存本机 │ │
│ │ 模型      [ llava:13b 👁       ▾ ]   │ │   ← 拉取后变下拉；👁=视觉可用；未拉取可手输
│ │ [ 测试连接 ]  [ 拉取模型 ]           │ │
│ │ ● 已连接 · 200 · 12 个模型 · 3 视觉  │ │   ← 状态行：good/warn/crit 三态
│ └─────────────────────────────────────┘ │
│ 密钥存本机 localStorage；长期见 后端 session│
└─────────────────────────────────────────┘
```

**动作语义**：
- **测试连接**：调后端探测端点（§5）；返回 `{ok, status, latency_ms, model_count?, reason?}`；状态行三态渲染（`--good`/`--warn`/`--crit`）。
- **拉取模型**：调后端模型列表端点；成功 → model 输入变 `<select>`，**全列**返回项 + 当前值，**视觉可用项前缀 👁**、非视觉项灰显但仍可选（附「未检出视觉能力」提示）；失败 → 保持文本框 + crit 提示。
- **provider 切换**：改 `base_url` 占位/默认；清空上次模型列表缓存；`openai_compatible` 时显示 Ollama / LM Studio 快填按钮。
- **快填（本地部署）**：Ollama → `http://localhost:11434/v1`，LM Studio → `http://localhost:1234/v1`；填后 API Key 提示可留空。

## 4. 数据模型

前端 `Connection`（存 `localStorage`，镜像后端可选 schema）：

```ts
interface Connection {
  provider: "anthropic" | "openai_compatible";
  baseUrl: string;        // "" → 用 provider 默认
  apiKey: string;         // 仅本机；发请求时随 body 传后端，不落 git/日志
  model: string;          // 选定模型 id
  models?: ModelInfo[];   // 上次拉取缓存（仅 UI 便利，可失效）
  lastTest?: { ok: boolean; at: string; reason?: string };
}
interface ModelInfo {
  id: string;
  vision: "yes" | "no" | "unknown"; // 视觉能力（§9：全列，按此标注 👁 / 灰显 / 待定）
}
```

后端 `InterpretRequest` **扩字段**（向后兼容，全部可选）：
```py
base_url: str | None = None    # 新增；None → provider 默认
provider: Literal["anthropic","openai_compatible"] = "anthropic"  # 新增
# api_key / model 沿用现有
```

## 5. 后端契约（新增两个薄端点）

复用 `ClaudeVLMBackend` 的 client 构造，抽出 provider 适配层（`AnthropicClient` / `OpenAICompatClient`），两者都实现 `list_models()` 与 `ping()`。

| 方法 | 路径 | 入 | 出 |
|---|---|---|---|
| POST | `/intent/vlm/test` | `{provider, base_url?, api_key?}` | `{ok, status, latency_ms, model_count?, vision_count?, reason?}` |
| POST | `/intent/vlm/models` | `{provider, base_url?, api_key?}` | `{models: [{id, vision}], reason?}` |

- `anthropic` → `GET {base_url}/v1/models`（SDK `client.models.list()`）。
- `openai_compatible`（含 Ollama / LM Studio）→ `GET {base_url}/v1/models`（OpenAI 契约同形）。
- **key 来源**：body `api_key` 优先，回退服务端 env；两者皆无 → 对**远端** provider `ok:false, reason:"缺少密钥"`（不抛栈）；对**本地**（localhost）base_url 允许空 key（Ollama/LM Studio 默认无鉴权）。
- 失败分类进 `reason`：DNS/超时、401/403、404（路径不对）、非 JSON、**连接被拒（本地服务未启动）**。
- **视觉能力判定（`vision` 字段，尽力而为，逐 provider）**：
  - `anthropic` → 按已知视觉模型族（Claude 3+ 全系支持）判 `yes`。
  - Ollama → 额外查 `POST {host}/api/show`，读 `capabilities` 含 `vision` → `yes`（Ollama 0.x 起返回）。
  - 其它 `openai_compatible`（LM Studio 等无能力元数据）→ 名称启发式（`llava`/`vl`/`vision`/`gpt-4o`/`gemini` 等）命中 → `yes`，否则 `unknown`（**不判 `no`，避免误杀**）。
  - 前端：`yes`→👁 可选；`unknown`→灰显可选 + 提示；`no`（仅 anthropic 明确非视觉时）→灰显。

## 6. 安全与关键权衡 ⚠️

- **SSRF vs 本地部署的张力** ⚠️：自定义 `base_url` 让**后端**发起请求 = 用户可让服务器打内网。但**支持 Ollama/LM Studio 恰恰要求放行 `http://localhost`**——与 SSRF「拒绝环回」直接冲突。v0 解法：**显式区分「本地回环」与「任意内网」**——① scheme 远端限 `https`，`http` 仅放行 `localhost`/`127.0.0.1`/`::1`（本地部署白名单）；② 拒绝解析到**其它**私网段（`10./172.16./192.168.` 等，除非部署方显式配 host 白名单）；③ 超时 + 响应大小上限。**判定基于解析后 IP，不能只看字符串**（防 `localhost.attacker.com` / DNS rebinding）。这是本设计**最高风险点**，落地前须安全评审。
  - 备选：改由**浏览器直连** provider（无 SSRF），但撞 CORS——多数网关不发 CORS 头，且 key 暴露在页面网络请求。权衡后 v0 倾向**后端代理 + SSRF 白名单**，与 `datasource` 的"服务端可达路径"边界一致。
- **密钥**：v0 仍 `localStorage`（现状），面板明示"仅存本机 / 共享机器请清除"（现有文案已有）。**不**写日志、**不**回显（password 型）、**不**入 `sources.json` 之类落盘清单。长期方案：后端 session（现有文案已埋此指向）。
- **降级**：VLM 连接不通时，`/interpret backend=vlm` 返回显式 503，UI 报错，不静默 fallback（不变量）。

## 7. 与现有 IntentConfig 的迁移

- `vlmKey`/`vlmModel`（localStorage）→ 迁进 `Connection`（`provider:"anthropic"`, `baseUrl:""`）；首次读旧值做一次性搬迁。
- Chip / `setCfgOpen` 开关、`GET /intent/backends` 保留；`backends` 项 `vlm` 的 `available` 语义不变（服务端 env 存在性），连接级可用性走新 `/intent/vlm/test`。

## 8. 范围（v0）与非目标

**做**：单 active 连接、两 provider（`openai_compatible` 覆盖 Ollama/LM Studio 本地部署）、测试、模型列表（全列 + 视觉标注）、SSRF 防护、localStorage 存储 + 迁移。
**非目标**：多连接并存/路由、每任务不同模型、后端密钥加密落库、**由 Glaux 拉起/守护本地推理进程**（连接已运行的本地服务是范围内；进程生命周期管理不是）、流式/多轮对话 UI（意图仍是单轮分类）、非 VLM 用途（分割/度量仍确定性，绝不接 LLM 估值——铁律）。

## 9. 开放问题

1. **SSRF vs 本地放行策略**：本地回环白名单 + 私网拒解析 + 基于 IP 判定（§6）是 v0 方向；**其它内网 host 白名单是否可配、配在哪**（env / sources 同级），须安全评审拍板。
   - **已加（缺省关，待评审确认）**：`GLAUX_VLM_HOST_ALLOW`（host 白名单，逗号分隔）、`GLAUX_VLM_ALLOW_FAKEIP`（放行 `198.18.0.0/15` fake-ip 段——Clash/Surge/sing-box 透明代理把域名映射到此保留段，是**实测撞到的**合法误拒场景；此段现实中不承载真实内部服务，故可选放行，其余私网仍拒）。评审需拍板：fake-ip 是否值得默认开、host 白名单粒度。
2. ~~**模型列表过滤**~~ **【已决议】**：**不过滤，全列**；逐项标注视觉能力（👁 `yes` / 灰显 `unknown` / 明确 `no`），判定逻辑见 §5。用户仍可选 `unknown` 项自担风险。
3. ~~**openai_compatible / 本地模型的图像意图**~~ **【已决议 + 收窄】**：视觉能力尽力而为检测（§5：anthropic 模型族 / Ollama `/api/show` / 名称启发式）；检测不到 → 标 `unknown` 不拦，真正看图失败在 `/interpret` 显式报错。**Ollama/LM Studio 已纳入 `openai_compatible`（US-5 / §0）**。
4. **多连接**：v0 单连接；若很快要多，`Connection` 应提前带 `id/name`（本设计已在数据模型留 provider 维度，加 `id` 成本低）。

## 10. 落地顺序（供后续 plan 展开）

1. 后端 provider 适配层（抽 `AnthropicClient`/`OpenAICompatClient` + `list_models`/`ping` + `vision` 判定；Ollama `/api/show` 探测）。
2. 后端两端点 `/intent/vlm/test`、`/intent/vlm/models` + SSRF 守卫（回环放行 / 私网拒解析 / IP 判定）+ 单测。
3. `InterpretRequest` 加 `base_url`/`provider`；`ClaudeVLMBackend` 走 base_url。
4. 前端 `Connection`/`ModelInfo` 模型 + localStorage 迁移。
5. `IntentConfig` UI 重构（provider 下拉 / Ollama·LM Studio 快填 / base_url / 测试 / 拉取 / 模型下拉带 👁 / 状态行）。
6. e2e：anthropic 官方 + 一个 openai 兼容网关 + **一个本地 Ollama** 各走通"测试 → 拉模型（含视觉标注）→ 选 → interpret"。
