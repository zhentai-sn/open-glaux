"""U9：结构化规范校验 + NL→规范三类落域 + 意图基线 + 规范/NL 驱动内核 e2e。"""

import numpy as np
import pytest

from glaux_imt.errors import HardReject
from glaux_imt.segmentation.stub import ConstantThicknessAdapter

from glaux_orchestrator.intent import ClaudeVLMBackend, IntentBackendUnavailable, RuleBasedBackend
from glaux_orchestrator.run import TaskResult, interpret_and_run, run_spec
from glaux_orchestrator.spec import IntentResult, Scope, TaskSpec, TaskType


# --- 规范校验 ---------------------------------------------------------------

def test_taskspec_validates_roi_and_cf():
    ok = TaskSpec(task=TaskType.FAR_WALL_CCA_IMT, cubs_cf=0.06, roi=(50, 150))
    assert ok.task is TaskType.FAR_WALL_CCA_IMT
    with pytest.raises(ValueError):
        TaskSpec(task=TaskType.FAR_WALL_CCA_IMT, roi=(150, 50))  # x1<=x0
    with pytest.raises(ValueError):
        TaskSpec(task=TaskType.FAR_WALL_CCA_IMT, cubs_cf=0.0)  # 非正


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
    ("estimate fetal head circumference", Scope.OUT_OF_SCOPE),
    ("测甲状腺结节大小", Scope.OUT_OF_SCOPE),
]


def test_intent_baseline_accuracy():
    backend = RuleBasedBackend()
    hits = sum(backend.interpret(nl).scope is exp for nl, exp in _CASES)
    assert hits == len(_CASES), f"意图基线 {hits}/{len(_CASES)}"


# --- 规范 / NL 驱动内核 e2e（stub 适配器） ----------------------------------

def _image():
    return np.zeros((120, 200), dtype=np.uint8)


def test_spec_drives_kernel_e2e():
    spec = TaskSpec(task=TaskType.FAR_WALL_CCA_IMT, cubs_cf=0.06)
    adapter = ConstantThicknessAdapter(li_y=50.0, thickness_px=8.0)
    res = run_spec(spec, adapter, _image())
    assert isinstance(res, TaskResult)
    assert res.mean_mm == pytest.approx(0.48)  # 8px × 0.06
    assert res.cf_source == "cubs"


def test_interpret_and_run_in_scope_executes():
    adapter = ConstantThicknessAdapter(li_y=50.0, thickness_px=8.0)
    res = interpret_and_run("测这张图远壁颈动脉 IMT", adapter, _image(), cubs_cf=0.06)
    assert isinstance(res, TaskResult) and res.mean_mm == pytest.approx(0.48)


def test_interpret_and_run_out_of_scope_does_not_touch_kernel():
    adapter = ConstantThicknessAdapter(li_y=50.0, thickness_px=8.0)
    res = interpret_and_run("分割乳腺肿瘤", adapter, _image(), cubs_cf=0.06)
    assert isinstance(res, IntentResult) and res.scope is Scope.OUT_OF_SCOPE


def test_spec_without_calibration_hard_rejects():
    spec = TaskSpec(task=TaskType.FAR_WALL_CCA_IMT, cubs_cf=None)  # 无 CF
    adapter = ConstantThicknessAdapter(li_y=50.0, thickness_px=8.0)
    with pytest.raises(HardReject):
        run_spec(spec, adapter, _image())


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
