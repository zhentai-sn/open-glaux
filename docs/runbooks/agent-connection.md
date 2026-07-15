# Agent 连接配置 runbook —— 自定义端点 / 连接测试 / 模型列表（含本地部署）

> 落地：[SDD](../designs/2026-07-14-001-agent-connection-config.zh-CN.md) ·
> [计划](../plans/2026-07-14-001-feat-agent-connection-config-plan.md)

## 一句话

意图后端从「Anthropic 官方 + 单 key + 手打 model」升级为 **连接（Connection）** 概念：选
provider（`anthropic` / `openai_compatible`）、填 `base_url`、**测试连接**、**拉取模型**（全列 + 👁
视觉标注）。`openai_compatible` **覆盖本地 Ollama / LM Studio**。密钥仍存本机 localStorage。

## 入口

Agent 面板标题栏 chip（`⚙ rule` / `✦ VLM · <model>`）→ 点开配置面板 → 选 **VLM（看图）** →
出现 provider / base_url / 密钥 / 模型 / 测试 / 拉取。

## 三个通道

### A. Anthropic 官方（缺省）

1. provider = **Anthropic**；`base_url` 留空（走官方端点）。
2. 密钥：面板填（存本机），或服务端 `ANTHROPIC_API_KEY`（面板显示「服务端 env 密钥 可用」）。
3. **测试连接** → `已连接 · 200 · N 模型 · M 视觉`；**拉取模型** → 下拉全是 Claude（👁，3+ 全系视觉）。

### B. OpenAI 兼容网关

1. provider = **OpenAI 兼容**；`base_url` 填网关地址（须含 `/v1`，如 `https://gw.example.com/v1`）。
2. 密钥填网关 key。**测试** → `已连接`；**拉取模型** → 全列；视觉能力走名称启发式（`llava`/`vl`/`gpt-4o`…→👁，其余 `·` 待定）。

### C. 本地 Ollama（vision 模型）

```bash
# 装并起 Ollama，拉一个视觉模型
ollama pull llava            # 或 llama3.2-vision / qwen2.5-vl
ollama serve                 # 默认 http://localhost:11434
```

1. provider = **OpenAI 兼容** → 点 **快填 · Ollama**（自动填 `http://localhost:11434/v1`）；密钥留空。
2. **测试连接** → `已连接 · 200 · N 模型`。
3. **拉取模型** → 视觉判定额外查 Ollama `/api/show` 的 `capabilities`：含 `vision` → 👁。选一个 👁 模型。
4. 在 Agent 输入框下达意图（如「测这张颈动脉远壁 IMT」）→ 走 `openai_compatible` 看图判定。

> **LM Studio** 同理：快填 · LM Studio（`http://localhost:1234/v1`），起本地服务并加载模型即可。

## SSRF 守卫（安全）

自定义 `base_url` 由**后端**发起请求，故有 SSRF 守卫（`backend/app/net_guard.py`）：

- `https` 远端放行；`http` **仅**放行解析到**回环**（localhost/127.0.0.1/::1）的 host —— 这是本地部署的口子。
- 基于 `getaddrinfo` **解析后的 IP** 判定（防 `localhost.attacker.com` / DNS rebinding），拒其它私网段。
- 需连内网自建 GPU 机：`export GLAUX_VLM_HOST_ALLOW=gpu-box.internal`（逗号分隔多个）后重启后端。
- **透明代理 / fake-ip**（Clash/Surge/sing-box）：这类代理把域名映射到 `198.18.0.0/15`（RFC 2544 保留段）做透明转发，守卫按保留地址拒。若你的网关走 fake-ip，`export GLAUX_VLM_ALLOW_FAKEIP=1` 放行该段（其余私网仍拒）后重启后端。比逐个 `GLAUX_VLM_HOST_ALLOW` 省事。
  - 注意：WSL 内的后端能否真把 `198.18.x.x` 路由到 Windows 侧代理，取决于 WSL 网络模式（mirrored 通常可、NAT 可能不可）——放行只是过了守卫，能否连通是网络层的事。
- **残留风险（待安全评审）**：解析在守卫、httpx 请求时再解析 = TOCTOU；彻底缓解需把 IP 钉进连接（见 SDD §6）。

## 已验证（2026-07-14，本机）

- 后端：`test_vlm_providers`(17) + `test_net_guard`(7) + `test_vlm_probe_api`(5) + `test_intent_vlm`(7) 全绿；现有 115 测试零破坏（总 151）。
- 前端：`tsc` + `build` 绿；旧 `glaux.vlmKey/vlmModel` → `glaux.connection` 自动迁移（旧键保留可回滚）。
- UI 闭环（preview 实测）：
  - openai_compatible → 快填 Ollama → base_url 填入 → 测试连接 → `连接被拒（本地服务未启动？）`（无本地 Ollama 时的正确报错，全链路通）。
  - 私网 `https://10.0.0.9/v1` 测试 → `base_url 被拒：拒绝内网/保留地址`（SSRF 守卫生效）。

## 待真机 e2e（端到端验收项）

以下需真实密钥 / 本地模型，留作端到端验收：

- [ ] Anthropic 官方：填真 key → 测试 → 拉模型 → 选 → 下达意图看图判定。
- [ ] 本地 Ollama（llava）：起服务 → 快填 → 测试 → 拉模型（👁 标注正确）→ 看图判 IMT/HC。
- [ ] 一个真实 OpenAI 兼容网关：同上闭环。
