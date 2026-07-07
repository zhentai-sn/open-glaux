"""规范 → 内核 的驱动（U9，多模态·无分支）。

``run_spec`` 把确定的 :class:`TaskSpec` 落成内核调用链，**读注册表、不按任务 if 分派**：

    标定 → 统一适配器 ``Adapter.run`` → 注册表的 ``measure`` 原语 → 统一 :class:`TaskOutput`。

几何差异全部收进 :class:`~glaux_core.contracts.Detection` 的带类型 primitives 与
:data:`~glaux_orchestrator.tasks.REGISTRY` 的 ``measure`` 可调用——加一种任务，此文件一行不改。
``interpret_and_run`` = 意图解析 + 执行；**非 in-scope 直接返回 IntentResult，不碰内核**
（歧义/超范围不静默错跑）。图像以 ndarray 注入，保持编排层与 IO 解耦、可测。
"""

from __future__ import annotations

import numpy as np

from glaux_core.calibration.calibration import resolve_calibration
from glaux_core.contracts import TaskOutput
from glaux_core.segmentation.base import ROI, Adapter, DetectRequest

from glaux_orchestrator.intent import IntentBackend, RuleBasedBackend
from glaux_orchestrator.spec import IntentResult, Scope, TaskSpec
from glaux_orchestrator.tasks import REGISTRY


def run_spec(spec: TaskSpec, adapter: Adapter, image: np.ndarray) -> TaskOutput:
    """执行一个确定的 TaskSpec：标定 → 统一适配器 → 注册表测量原语 → TaskOutput。

    - 缺标定 → 内核 :class:`HardReject`（不出无标定的假值）。
    - 适配器几何族与任务不匹配 → :class:`TypeError`（替代散落各处的 isinstance 联合）。
    """
    plugin = REGISTRY[spec.task]
    cal = resolve_calibration(cubs_cf=spec.cubs_cf)  # 无标定 → HardReject
    if adapter.kind != plugin.adapter_kind:
        raise TypeError(
            f"{spec.task.value} 需 {plugin.adapter_kind} 适配器，"
            f"得 {adapter.kind}（{type(adapter).__name__}）"
        )
    roi = ROI(spec.roi[0], spec.roi[1]) if spec.roi is not None else None
    det = adapter.run(DetectRequest(image=image, roi=roi))
    meas = plugin.measure(det, cal)
    return TaskOutput(
        task=spec.task.value,
        metrics=meas.metrics,
        primitives=tuple(det.primitives) + tuple(meas.overlays),
        calibration=cal,
        provenance={
            "model_version": det.model_version,
            "method": spec.method,
            "cf_source": cal.source.value,
            "roi_used": det.roi_used,
        },
    )


def interpret_and_run(
    nl: str,
    adapter: Adapter,
    image: np.ndarray,
    *,
    image_path: str | None = None,
    cubs_cf: float | None = None,
    roi: tuple[int, int] | None = None,
    backend: IntentBackend | None = None,
) -> TaskOutput | IntentResult:
    """NL → 规范 → 执行。非 in-scope 返回 IntentResult（澄清/拒绝），不驱动内核。"""
    backend = backend or RuleBasedBackend()
    intent = backend.interpret(
        nl, image_path=image_path, cubs_cf=cubs_cf, roi=roi, has_image=image is not None
    )
    if intent.scope is not Scope.IN_SCOPE:
        return intent
    return run_spec(intent.spec, adapter, image)
