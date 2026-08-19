# Agent 连接配置 runbook —— 自定义端点 / 连接测试 / 模型列表（含本地部署）

> 落地：[SDD（已 superseded）](../designs/2026-07-14-001-agent-connection-config.zh-CN.md) ·
> [计划](../plans/2026-07-14-001-feat-agent-connection-config-plan.md) ·
> **2026-08-16 起后端实现在 agent-runtime**（[退役设计](../designs/2026-08-16-001-retire-orchestration.zh-CN.md) P2）
>
> 更新记录：2026-08-16 —— 探测端点与 SSRF 守卫迁至 agent-runtime；"意图后端 rule/VLM 二选一"随意图层退役，
> 连接配置现在只服务参考智能体本身。

## 一句话

参考智能体的模型连接是一个 **连接（Connection）**：选 provider（`anthropic` / `openai_compatible`）、
填 `base_url`、**测试连接**、**拉取模型**（全列 + 👁 视觉标注）。`openai_compatible` **覆盖本地 Ollama /
LM Studio**。密钥存本机 localStorage，随每次命令临时传给 agent-runtime，不落库。

## 入口

Focus 顶栏 / Agent 面板的 **⚙ 连接设置** → provider / base_url / 密钥 / 模型（拉取后下拉选）/ 测试 /
拉取；OpenAI 兼容自定义模型还需填上下文窗口与最大输出。

## 请求走向

- 测试连接：`POST /agent-api/v1/connection/test` → `{ ok, http_status, reason, model_count? }`
- 拉取模型：`POST /agent-api/v1/connection/models` → `{ models: [{ id, vision }], reason? }`
- 两个端点都在 **agent-runtime**（[`connection-probe.ts`](../../agent-runtime/src/pi/connection-probe.ts)）；
  backend 不再有 `/intent/vlm/*`。这是架构不变量"只有 agent-runtime 与模型说话"的一部分。

## 三个通道

### A. Anthropic 官方（缺省）

1. provider = **Anthropic**；`base_url` 留空（走官方端点）。
2. 密钥：面板填（存本机），或给 **agent-runtime 进程**设 `ANTHROPIC_API_KEY`（面板留空时回退）。
3. **测试连接** → `已连接 · N 模型`；**拉取模型** → 下拉全是 Claude（👁，3+ 全系视觉；pi-ai 内置目录判定）。

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
3. **拉取模型** → 视觉判定额外查 Ollama `/api/show` 的 `capabilities`：含 `vision` → 👁。选一个模型。
4. 在对话里下指令（如「测这张颈动脉远壁 IMT」）→ 智能体调 `run_task` 工具跑当前任务，结果回到查看器。

> **LM Studio** 同理：快填 · LM Studio（`http://localhost:1234/v1`），起本地服务并加载模型即可。

## SSRF 守卫（安全）

自定义 `base_url` 由 **agent-runtime** 发起请求，故有出站守卫（[`agent-runtime/src/security/net-guard.ts`](../../agent-runtime/src/security/net-guard.ts)，2026-08-16 自 `backend/app/net_guard.py` 移植，规则逐条一致）：

- `https` 远端放行；`http` **仅**放行解析到**回环**（localhost/127.0.0.1/::1）的 host —— 这是本地部署的口子。
- 基于 DNS **解析后的 IP** 判定（防 `localhost.attacker.com` / DNS rebinding），拒其它私网段（IPv4/IPv6）。
- 需连内网自建 GPU 机：给 **agent-runtime 进程**设 `GLAUX_VLM_HOST_ALLOW=gpu-box.internal`（逗号分隔多个）后重启 agent-runtime。
- **透明代理 / fake-ip**（Clash/Surge/sing-box）：这类代理把域名映射到 `198.18.0.0/15`（RFC 2544 保留段）做透明转发。该段**默认放行**（2026-08-19 决议：此段现实中不承载真实内部服务，误拒代价远高于放行风险），走 fake-ip 的机器无需任何配置；要收紧就给 agent-runtime 设 `GLAUX_VLM_ALLOW_FAKEIP=0` 后重启，其余私网无论开关一律拒。
  - 注意：WSL 内的进程能否真把 `198.18.x.x` 路由到 Windows 侧代理，取决于 WSL 网络模式（mirrored 通常可、NAT 可能不可）——放行只是过了守卫，能否连通是网络层的事。
- 被拒时端点返回 `400 { error: { code: "egress_blocked", message } }`，且**不发起任何网络请求**。
- **残留风险（待安全评审）**：解析在守卫、fetch 时再解析 = TOCTOU；彻底缓解需把 IP 钉进连接。

## 已验证

- 2026-08-16（迁移后）：agent-runtime `net-guard.test.ts`(13) + `connection-api.test.ts`(14) 全绿——守卫回环/私网/fake-ip/白名单/混合解析/DNS 失败，探测三条视觉判定路径（anthropic 目录 / Ollama capabilities / 名称启发式），端点 400/守卫短路/密钥不入错误体；前端 `tsc`/`eslint`/vitest 绿。
- 2026-07-14（迁移前，历史）：Python 版 `test_vlm_providers`(17) + `test_net_guard`(7) + `test_vlm_probe_api`(5) 全绿；旧 `glaux.vlmKey/vlmModel` → `glaux.connection` 自动迁移。
- UI 闭环（2026-08-16 真机）：OpenAI 兼容 → deepseek-v4-flash 拉模型/选模型/对话，`run_task` 工具调用成功回写查看器。

## 待真机 e2e（端到端验收项）

以下需真实密钥 / 本地模型，留作端到端验收：

- [ ] Anthropic 官方：填真 key → 测试 → 拉模型 → 选 → 对话里让它测 IMT（走 `run_task`）。
- [ ] 本地 Ollama（llava）：起服务 → 快填 → 测试 → 拉模型（👁 标注正确）→ 对话闭环。
- [x] 一个真实 OpenAI 兼容网关：deepseek-v4-flash 已闭环（2026-08-16）。
