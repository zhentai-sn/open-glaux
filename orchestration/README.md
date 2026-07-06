# orchestration · 编排 / 任务规范层（Phase B · U9）

把**自然语言（+ 图像）意图**翻译成**结构化任务规范**，再驱动科学内核
（`science-core/glaux_imt`）端到端。护城河的分工：**内核确定性、可复现**；
**意图理解是独立失败面**，单独评测、与分割 CV 解耦。

## 设计不变量

1. **结构化规范是内核入口**（`spec.TaskSpec`）：字段明确、可校验、可序列化，
   本身无 NL 歧义。所有 LLM/VLM 不确定性都收敛在「NL→规范」这一步。
2. **NL→规范是薄映射**（`intent`）：
   - `RuleBasedBackend`（v0）：确定性关键词映射，可复现、可测，聚焦 canonical 用例
     「测远壁 CCA IMT」。
   - `ClaudeVLMBackend`：真实 VLM 接缝（看图 + NL）——隔离在接口后，需 SDK + 密钥，
     未接线时显式报错（对齐 caroSegDeep 的 `ModelAdapter` 接缝模式）。
3. **歧义/超范围显式识别、不静默错跑**（沿用标定层硬拒绝哲学）：
   `interpret_and_run` 对非 in-scope 直接返回 `IntentResult`，**不碰内核**。

## 数据流

```
NL(+image) --interpret--> IntentResult
                             ├─ in_scope     --> TaskSpec --run_spec--> 内核: 标定→分割→PDM测量 --> TaskResult
                             ├─ ambiguous    --> 澄清（不执行）
                             └─ out_of_scope --> 拒绝（不执行）
```

## 运行

编排层依赖 `science-core` 的 `glaux_imt`。测试需两包同在 `PYTHONPATH`：

```bash
cd orchestration
PYTHONPATH=.:../science-core python -m pytest
```

## 意图评测

`tests/intent_cases.md` 是小而 canonical 的意图集；`test_spec.py::test_intent_baseline_accuracy`
断言规则后端在其上的基线。真实鲁棒性（改写/多语/含糊）是 VLM 后端的提升方向，
但**关键属性是歧义/超范围被显式识别**，而非分数本身。

## 尚未接线（Phase B 后续）

- `ClaudeVLMBackend` 真实调用（受约束解码 → 校验成 `TaskSpec`）。
- 无代码修正 UI（拖边界/挪 ROI）→ 回流记忆层。
- `image_path → ndarray` 的 IO 装配（当前 `run_spec` 以 ndarray 注入，保持可测）。
