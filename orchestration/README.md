# orchestration · 意图层（**退役中**）

> ⚠ 本目录按 [退役设计](../docs/designs/2026-08-16-001-retire-orchestration.zh-CN.md) 分三步拆除：
> **P1（2026-08-16，已完成）** 任务注册表 `TaskType` / `TaskSpec` / `REGISTRY` 迁入
> `science-core/glaux_core/tasks.py`，本目录的 `spec.py` / `tasks.py` 仅剩兼容重导出，`run.py` 已删；
> **P2** 模型连接探测（`vlm_providers.py`）迁入 agent-runtime；**P3** 意图解析（`intent.py`）交还
> agent，本目录删除。新代码请勿 import `glaux_orchestrator`。

把**自然语言（+ 图像）意图**翻译成**结构化任务规范**，再驱动科学内核端到端。
护城河的分工：**内核确定性、可复现**；**意图理解是独立失败面**，单独评测、与分割 CV 解耦。

## 设计不变量

1. **结构化规范是内核入口**（`glaux_core.tasks.TaskSpec`）：字段明确、可校验、可序列化，
   本身无 NL 歧义。所有 LLM/VLM 不确定性都收敛在「NL→规范」这一步。
2. **NL→规范是薄映射**（`intent`）：
   - `RuleBasedBackend`（v0）：确定性关键词映射，可复现、可测，聚焦 canonical 用例
     「测远壁 CCA IMT」。
   - `ClaudeVLMBackend`：真实 VLM 接缝（看图 + NL）——隔离在接口后，需 SDK + 密钥，
     未接线时显式报错（对齐 caroSegDeep 的 `ModelAdapter` 接缝模式）。
3. **歧义/超范围显式识别、不静默错跑**（沿用标定层硬拒绝哲学）：
   非 in-scope 直接返回 `IntentResult`，**不碰内核**。

## 数据流

```
NL(+image) --interpret--> IntentResult
                             ├─ in_scope     --> TaskSpec --> backend kernel（读 REGISTRY）: 标定→分割→测量
                             ├─ ambiguous    --> 澄清（不执行）
                             └─ out_of_scope --> 拒绝（不执行）
```

## 运行

依赖 `science-core`（`glaux_core`）与 `httpx` / `anthropic`（后两者在 backend 的 venv 里）：

```bash
cd orchestration
PYTHONPATH=.:../science-core ../backend/.venv/bin/python -m pytest
```

## 意图评测

`tests/intent_cases.md` 是小而 canonical 的意图集；`test_spec.py::test_intent_baseline_accuracy`
断言规则后端在其上的基线。真实鲁棒性（改写/多语/含糊）是 VLM 后端的提升方向，
但**关键属性是歧义/超范围被显式识别**，而非分数本身。

## 后续

不再新增功能；剩余的 `intent.py` / `vlm_providers.py` 按退役设计 P2 / P3 迁出或删除。
