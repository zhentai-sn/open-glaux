# 计划：智能体连接配置 —— 自定义端点 / 连接测试 / 模型列表（含本地部署 + 视觉标注）

> 落地 [SDD · 智能体连接配置](../designs/2026-07-14-001-agent-connection-config.zh-CN.md)。
> 把当前「后端二选一 + 单 key + 手打 model」的 `IntentConfig` 升级为**类 ChatBox 的连接管理**：
> 自定义 `base_url`、连接测试、拉取模型列表（全列 + 👁 视觉标注），并把 **Ollama / LM Studio
> 本地部署**纳入 `openai_compatible`。

## 0. 一句话

引入 **Connection（连接）** 一等概念（`{provider, base_url, api_key, model}`）；后端抽出
**provider 适配层**（`anthropic` / `openai_compatible`）实现 `ping` / `list_models` / 视觉判定，
加两个薄探测端点 + SSRF 守卫；前端把 `IntentConfig` 重构成连接编辑器。**向后兼容**：不填
`base_url` = 现状 anthropic 行为逐字节不变。

## 1. 现状（改造起点，均有据可查）

| 位置 | 现状 | 证据 |
|---|---|---|
| 意图后端 | `IntentBackend` ABC + `RuleBasedBackend` / `ClaudeVLMBackend`（anthropic SDK 硬编） | [`intent.py:36-229`](../../orchestration/glaux_orchestrator/intent.py) |
| 可用性探测 | `ClaudeVLMBackend.available()` 只查 `ANTHROPIC_API_KEY` env | [`intent.py:156-165`](../../orchestration/glaux_orchestrator/intent.py) |
| 内核装配 | `_rule` / `_vlm` 单例；`intent_backends()` 硬编两项；`interpret(backend, api_key, model)` | [`kernel.py:61-108`](../../backend/app/kernel.py) |
| 契约 | `InterpretRequest{backend, api_key?, model?}`；`IntentBackendInfo{id: Literal["rule","vlm"]}` | [`schemas.py:31-46`](../../backend/app/schemas.py) |
| 端点 | `GET /intent/backends`、`POST /interpret`（VLM 不可用 → 503 不降级） | [`api.py:88-113`](../../backend/app/routers/api.py) |
| 前端状态 | `intentBackend` / `vlmKey` / `vlmModel`（localStorage `glaux.vlmKey`/`glaux.vlmModel`） | [`session.ts:77-80,151-203`](../../frontend/src/store/session.ts) |
| 前端调用 | `useAgent` 读 `vlmKey/vlmModel` 传 `api.interpret` | [`useAgent.ts:22-28`](../../frontend/src/agent/useAgent.ts) |
| 前端 UI | `IntentConfig`：radio + password key + model 文本框 | [`AgentPanel.tsx:9-67`](../../frontend/src/components/AgentPanel.tsx) |
| 文案 | `cfg_*` / `vlm_*` i18n 键 | [`i18n/zh.ts`](../../frontend/src/i18n/zh.ts) |

**接缝已埋好**：`IntentBackend` ABC 的「两后端同契约」模式、`interpret` 已透传 `api_key/model`、
`InterpretRequest` 已可选字段——本计划沿此加 `provider/base_url` 维度，不另起炉灶。

## 2. 目标 / 非目标

**做：**
- provider 适配层（`AnthropicClient` / `OpenAICompatClient`）：`ping()` / `list_models()→[ModelInfo]` / 视觉判定。
- 两端点 `POST /intent/vlm/test`、`POST /intent/vlm/models` + **SSRF 守卫**（回环放行 / 私网拒解析 / 基于解析 IP）。
- `InterpretRequest` 加 `provider` / `base_url`；`interpret` 路由到对应 provider（含 openai_compatible 的看图 tool-use 适配）。
- 前端 `Connection` / `ModelInfo` 模型 + localStorage 迁移；`IntentConfig` 重构（provider 下拉 / Ollama·LM Studio 快填 / base_url / 测试 / 拉取 / 模型下拉带 👁 / 状态行）。
- Ollama（`:11434/v1`）/ LM Studio（`:1234/v1`）本地部署走通。

**明确不做（边界，沿 SDD §8）：**
- 多连接并存/路由、每任务不同模型（v0 单 active 连接）。
- 由 Glaux **拉起/守护**本地推理进程（连已运行的服务在内；进程生命周期不在）。
- 密钥后端加密落库（v0 仍 localStorage + 可选 env）；流式/多轮对话 UI。
- 非 VLM 用途——分割/度量仍确定性，**绝不接 LLM 估值**（铁律）。

## 3. 分阶段落地（每阶段独立可测，先后端后前端）

### P1 · provider 适配层（后端/orchestration） ★核心

**新增** `orchestration/glaux_orchestrator/vlm_providers.py`：

```python
@dataclass(frozen=True)
class ModelInfo:
    id: str
    vision: Literal["yes", "no", "unknown"]

class VLMProvider(ABC):
    def ping(self) -> tuple[bool, int, str]: ...        # (ok, http_status, reason)
    def list_models(self) -> list[ModelInfo]: ...        # 全列 + 视觉判定

class AnthropicProvider(VLMProvider):   # 复用 anthropic SDK；base_url 可覆盖
    # list_models → client.models.list()；vision 按 Claude 模型族判 yes
class OpenAICompatProvider(VLMProvider):  # httpx 直连 {base_url}/v1/models
    # vision：先试 {host}/api/show（Ollama capabilities 含 vision）→ yes；
    #        否则名称启发式（llava/vl/vision/gpt-4o/gemini…）→ yes，否则 unknown（不判 no）
```

- **不动** `RuleBasedBackend`。`ClaudeVLMBackend` 的 client 构造改为委托 `AnthropicProvider`（保持 `interpret` 行为不变——回归零破坏）。
- 视觉启发式词表 + Claude 模型族列表集中在此模块，单点可维护。

**验收**：`orchestration/tests/test_vlm_providers.py`——
- `AnthropicProvider.list_models` mock SDK 返回 → 全部标 `vision:yes`；
- `OpenAICompatProvider` mock httpx：`/api/show` 命中 `vision` → yes；未命中走名称启发式（`llava:13b`→yes，`qwen2.5:7b`→unknown）；
- `ping` 对连接被拒 / 超时 / 401 各归类 reason。

### P2 · 两个探测端点 + SSRF 守卫（后端）

**新增** `backend/app/net_guard.py`：`assert_url_allowed(url) -> None`——
- scheme 远端限 `https`；`http` 仅放行解析到**回环**（`127.0.0.0/8` / `::1`）的 host。
- **基于 `socket.getaddrinfo` 解析后的 IP** 判定（防 `localhost.attacker.com` / DNS rebinding），拒其它私网段（`10./172.16-31./192.168./169.254./fc00::/7`），除非命中显式 host 白名单（env `GLAUX_VLM_HOST_ALLOW`，逗号分隔，v0 缺省空）。
- 超时（connect 3s / read 8s）+ 响应体大小上限（1 MB）。

**新增** `schemas.py`：
```python
class ProbeRequest(BaseModel):
    provider: Literal["anthropic", "openai_compatible"] = "anthropic"
    base_url: str | None = None
    api_key: str | None = None
class TestResult(BaseModel):
    ok: bool; status: int | None; latency_ms: int | None
    model_count: int | None = None; vision_count: int | None = None; reason: str
class ModelListResult(BaseModel):
    models: list[ModelInfoSchema]; reason: str = ""
```

**新增** `api.py` 端点（`kernel` 里加 `vlm_test()` / `vlm_models()` 薄封装 → provider 适配层）：
- `POST /intent/vlm/test` → `ProbeRequest` → `TestResult`（先 `assert_url_allowed` 再 `ping`）。
- `POST /intent/vlm/models` → `ProbeRequest` → `ModelListResult`。
- key 来源：body 优先 → env 回退；**本地回环** base_url 允许空 key（Ollama/LM Studio 默认无鉴权）。

**验收**：`backend/tests/test_vlm_probe_api.py` + `test_net_guard.py`——
- `net_guard`：`http://localhost:11434/v1` 放行；`http://10.0.0.5` 拒；`https://api.anthropic.com` 放行；`http://localhost.evil.com`（解析到公网）拒。
- 端点：mock provider → test 返回 `{ok, model_count, vision_count}`；无 key + 远端 → `ok:false reason 含"缺少密钥"`；SSRF 拒 → 400 显式 reason。
- **回归**：现有 `test_api.py` 的 `/intent/backends`、`/interpret` 全绿（零破坏）。

### P3 · interpret 路由到 provider（后端） ★最重

- `InterpretRequest` 加 `provider: Literal["anthropic","openai_compatible"]="anthropic"`、`base_url: str | None=None`（均可选，缺省 = 现状）。
- `kernel.interpret` 透传 `provider/base_url` 给 VLM 后端。
- **anthropic**：`base_url` 传入 SDK client（`anthropic.Anthropic(api_key, base_url=...)`），其余不变。
- **openai_compatible**：新增看图 tool-use 适配——OpenAI 的 `tools`(function) + `tool_choice` + 图片走 `image_url`(data URI) content。把 `_VLM_SYSTEM` / `report_intent` 契约映射到 OpenAI function schema，解析 `tool_calls[0].function.arguments`。
  - **风险**：兼容网关的 function-calling / vision 支持参差；失败 → 现有 `IntentBackendUnavailable` → 503（沿用不静默降级铁律）。这是本计划最大不确定项，单独 spike 验证一个真实 Ollama vision 模型。

**验收**：`orchestration/tests/test_intent.py` 扩展——
- anthropic + base_url 覆盖：mock SDK 收到 base_url；
- openai_compatible：mock OpenAI 兼容响应（function tool_call）→ 正确解析三态；无 tool_call → `IntentBackendUnavailable`；
- **e2e（手动 runbook）**：本地 Ollama（llava）走通 `interpret` 看图判 IMT/HC。

### P4 · 前端连接模型 + localStorage 迁移

- `session.ts`：`IntentBackendId` 保留；新增 `Connection` / `ModelInfo`（镜像后端 §4）。
- 状态从 `vlmKey`/`vlmModel` 迁到 `connection: Connection`；**一次性搬迁**——首读若无 `glaux.connection` 但有旧 `glaux.vlmKey`/`glaux.vlmModel` → 组装成 `{provider:"anthropic", baseUrl:"", apiKey, model}` 落新键（旧键保留一版，不删，回滚可用）。
- `client.ts`：`interpret` opts 加 `provider`/`base_url`；新增 `api.vlmTest()` / `api.vlmModels()`。
- `useAgent.ts`：从 `connection` 取 `provider/base_url/apiKey/model` 传 `interpret`。

**验收**：`npx tsc --noEmit` 绿；旧 localStorage（含 `glaux.vlmKey`）载入 → 自动出现在新连接里（手测：预置旧键刷新页面）。

### P5 · IntentConfig UI 重构（前端）

按 SDD §3 面板结构重写 [`AgentPanel.tsx` `IntentConfig`](../../frontend/src/components/AgentPanel.tsx)：
- provider `<select>`（anthropic / openai_compatible）；`openai_compatible` 时显 **Ollama / LM Studio 快填按钮**（一键填本机 base_url + 提示 key 可留空）。
- `base_url` 输入（随 provider/快填给占位/默认）；`api_key` password；
- **测试连接**按钮 → `api.vlmTest` → 状态行三态（`--good`/`--warn`/`--crit`），显 `200 · N 模型 · M 视觉`；
- **拉取模型**按钮 → `api.vlmModels` → model 从文本框变 `<select>`：**全列**，`vision:yes`→前缀 👁、`unknown`→灰显 + title 提示、`no`→灰显；仍可手输。
- chip 文案 `✦ VLM · <model 简称>`（[AgentPanel.tsx:201](../../frontend/src/components/AgentPanel.tsx)）。
- i18n：`i18n/zh.ts` + `en.ts` 增 `cfg_provider` / `cfg_base_url` / `cfg_test` / `cfg_fetch_models` / `cfg_local_ollama` / `cfg_local_lmstudio` / `cfg_vision` / 状态行文案；CSS：`global.css` `.cfgvlm` 附近加 provider 行 / 按钮 / 状态行样式（复用 `--good/--warn/--crit`）。

**验收**：`npx tsc --noEmit` + `npm run build` 绿；preview 手测——
- provider 切 openai_compatible → 快填 Ollama → base_url 填入；
- 测试连接（对 mock 或本地服务）→ 状态行三态正确；
- 拉取模型 → 下拉出现、👁 标注正确；
- 切回 rule → 连接配置不丢（重开面板仍在）。

### P6 · e2e 收口 + runbook

- 三通道各走通「测试 → 拉模型（含视觉标注）→ 选 → interpret」：① anthropic 官方；② 一个 openai 兼容网关；③ **本地 Ollama（vision 模型）**。
- 新增 `docs/runbooks/agent-connection.md`：三通道各自的 base_url / 起服务 / 已知坑（CORS 不涉及因走后端代理；Ollama 需 `ollama pull llava`）。

## 4. 落地顺序与依赖

```
P1(适配层) ──▶ P2(端点+SSRF) ──▶ P3(interpret 路由)
                    │                    │
                    ▼                    ▼
              P4(前端模型/迁移) ──▶ P5(UI 重构) ──▶ P6(e2e+runbook)
```

- P1→P2→P3 后端链；P4 可与 P2 并行起步（契约 §4/§5 已定）。P5 依赖 P4 + P2 端点。
- **每阶段独立提交**，后端每阶段跑 `uv run pytest -q`（现 124 测试基线，只增不减），前端 P4/P5 跑 typecheck + build。

## 5. 风险与缓解

| 风险 | 缓解 |
|---|---|
| **SSRF 放行本地 vs 拒内网**（最高，§SDD 6） | `net_guard` 基于解析 IP 判定 + 单测覆盖 rebinding；落地前安全评审 |
| **openai_compatible 看图 tool-use 参差**（P3 最重） | 先 spike 一个真实 Ollama vision 模型；失败显式 503 不臆造 |
| 视觉能力误判 | 不判 `no`（除 anthropic 明确），`unknown` 仍可选 + 提示，真失败在 interpret 报错 |
| localStorage 迁移丢配置 | 旧键保留一版不删；搬迁幂等（有新键则跳过） |
| 现有 VLM 行为回归 | `ClaudeVLMBackend` 委托 `AnthropicProvider` 后跑现有 `test_intent`；不填 base_url 路径逐字节等价 |

## 6. 验收总纲（Definition of Done）

- 后端：`test_vlm_providers` / `test_net_guard` / `test_vlm_probe_api` 新增全绿；现有 124 测试零破坏。
- 前端：`tsc --noEmit` + `build` 绿；旧配置自动迁移。
- e2e：anthropic 官方 + 一个兼容网关 + 本地 Ollama 三通道「测试→拉模型→选→interpret」各走通，视觉标注正确。
- 文档：runbook 落地；SDD 开放问题 #1（SSRF 白名单粒度）经安全评审拍板后回填。
