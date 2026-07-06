# 意图评测小集（U9）

意图理解是**与分割 CV 解耦的独立失败面**：这里量的是「听懂人话」，而非「量得准」。
用例刻意小而 canonical（v0）；真实鲁棒性（改写/多语/含糊）是 VLM 后端要提升的方向。
`RuleBasedBackend` 在此集上的基线由 `test_spec.py::test_intent_baseline_accuracy` 断言。

判定标签：`in_scope`（可映射成远壁 CCA IMT 规范）/ `ambiguous`（测量意图但目标不明，需澄清）/
`out_of_scope`（非颈动脉 IMT，超 v0 能力）。

| # | 自然语言输入 | 期望 |
| --- | --- | --- |
| 1 | 测量这张颈动脉超声图远壁的 IMT | in_scope |
| 2 | 分割 CCA 内中膜并给出厚度 | in_scope |
| 3 | measure the far wall carotid intima-media thickness | in_scope |
| 4 | 这张图的颈动脉内中膜厚度是多少 | in_scope |
| 5 | 帮我量一下远壁 IMT | in_scope |
| 6 | 分析一下这张图 | ambiguous |
| 7 | 帮我看看这张超声 | ambiguous |
| 8 | measure this | ambiguous |
| 9 | 计算左心室射血分数 EF | out_of_scope |
| 10 | 分割乳腺肿瘤并测最大径 | out_of_scope |
| 11 | estimate fetal head circumference | out_of_scope |
| 12 | 测甲状腺结节大小 | out_of_scope |

**基线**：规则后端在此 12 例 canonical 集上应 100% 命中（12/12）。
关键属性不是高分本身，而是**歧义/超范围被显式识别、不被静默跑成 IMT**。
