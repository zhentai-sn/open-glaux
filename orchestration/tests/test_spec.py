"""意图层测试——IntentResult 不变量、NL→规范三类落域、意图基线、VLM 后端可用性。

``TaskSpec`` 校验与规范驱动内核的 e2e 已随注册表迁入 ``science-core/tests/test_tasks.py``
（2026-08-16，退役 orchestration P1）；本文件剩余用例随意图层在 P3 退役。
"""

import pytest

from glaux_core.tasks import TaskSpec, TaskType

from glaux_orchestrator.intent import ClaudeVLMBackend, IntentBackendUnavailable, RuleBasedBackend
from glaux_orchestrator.spec import IntentResult, Scope


# --- 意图结果不变量 ------------------------------------------------------------

def test_intent_result_invariants():
    with pytest.raises(ValueError):  # IN_SCOPE 必须带 spec
        IntentResult(Scope.IN_SCOPE, None, "x")
    with pytest.raises(ValueError):  # 非 IN_SCOPE 不得带 spec（不静默错跑）
        IntentResult(Scope.OUT_OF_SCOPE, TaskSpec(task=TaskType.FAR_WALL_CCA_IMT), "x")


# --- NL→规范 三类落域 -------------------------------------------------------

def test_nl_canonical_in_scope_builds_spec():
    r = RuleBasedBackend().interpret("测量这张颈动脉超声图远壁的 IMT", image_path="a.tiff", cubs_cf=0.06)
    assert r.scope is Scope.IN_SCOPE
    assert r.spec.task is TaskType.FAR_WALL_CCA_IMT
    assert r.spec.image_path == "a.tiff" and r.spec.cubs_cf == 0.06


def test_nl_hc_in_scope_routes_to_fetal_task():
    r = RuleBasedBackend().interpret("测这张胎儿颅脑超声的头围", image_path="f.png", cubs_cf=0.12)
    assert r.scope is Scope.IN_SCOPE
    assert r.spec.task is TaskType.FETAL_HC
    assert r.spec.method == "ellipse-fit"  # 取自任务注册表默认方法


def test_nl_ambiguous_not_silently_run():
    r = RuleBasedBackend().interpret("分析一下这张图")
    assert r.scope is Scope.AMBIGUOUS and r.spec is None


def test_nl_out_of_scope_rejected():
    r = RuleBasedBackend().interpret("计算左心室射血分数 EF")
    assert r.scope is Scope.OUT_OF_SCOPE and r.spec is None


# --- 意图评测小集基线（对应 intent_cases.md） --------------------------------

_CASES = [
    ("测量这张颈动脉超声图远壁的 IMT", Scope.IN_SCOPE),
    ("分割 CCA 内中膜并给出厚度", Scope.IN_SCOPE),
    ("measure the far wall carotid intima-media thickness", Scope.IN_SCOPE),
    ("这张图的颈动脉内中膜厚度是多少", Scope.IN_SCOPE),
    ("帮我量一下远壁 IMT", Scope.IN_SCOPE),
    ("分析一下这张图", Scope.AMBIGUOUS),
    ("帮我看看这张超声", Scope.AMBIGUOUS),
    ("measure this", Scope.AMBIGUOUS),
    ("计算左心室射血分数 EF", Scope.OUT_OF_SCOPE),
    ("分割乳腺肿瘤并测最大径", Scope.OUT_OF_SCOPE),
    ("测甲状腺结节大小", Scope.OUT_OF_SCOPE),
    # 多模态：胎儿头围现为已注册任务 → in-scope
    ("estimate fetal head circumference", Scope.IN_SCOPE),
    ("测这张胎儿颅脑图的头围", Scope.IN_SCOPE),
    ("measure the HC", Scope.IN_SCOPE),
]


def test_intent_baseline_accuracy():
    backend = RuleBasedBackend()
    hits = sum(backend.interpret(nl).scope is exp for nl, exp in _CASES)
    assert hits == len(_CASES), f"意图基线 {hits}/{len(_CASES)}"


# --- VLM 后端：可用性探测 + 不可用时显式失败（不臆造、不静默） ---------------

def test_claude_vlm_backend_available_probe():
    ok, reason = ClaudeVLMBackend.available()
    assert isinstance(ok, bool) and isinstance(reason, str) and reason


def test_claude_vlm_backend_fails_explicitly_when_unavailable():
    # SDK 或密钥缺失 → 显式抛 IntentBackendUnavailable（绝不臆造规范）。
    # 二者都就绪时不在单测里打真实 API，仅验证契约存在。
    ok, _ = ClaudeVLMBackend.available()
    if ok:
        pytest.skip("anthropic + 密钥就绪；真实调用不在单测覆盖")
    with pytest.raises(IntentBackendUnavailable):
        ClaudeVLMBackend().interpret("测颈动脉 IMT")
