"""规范 → 内核 的驱动（U9）。

``run_spec`` 把确定的 :class:`TaskSpec` 落成内核调用链：标定 → 分割 → PDM 测量。
``interpret_and_run`` = 意图解析 + 执行；**非 in-scope 直接返回 IntentResult，不碰内核**
（歧义/超范围不静默错跑）。图像以 ndarray 注入，保持编排层与 IO 解耦、可测。
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from glaux_imt.calibration.calibration import resolve_calibration
from glaux_imt.measurement.pdm import imt
from glaux_imt.segmentation.base import ROI, ModelAdapter, SegmentationRequest

from glaux_orchestrator.intent import IntentBackend, RuleBasedBackend
from glaux_orchestrator.spec import IntentResult, Scope, TaskSpec


@dataclass(frozen=True)
class TaskResult:
    """编排执行产物——轻量、可序列化；完整产物/队列 CSV 走内核 artifacts 层。"""

    task: str
    mean_mm: float
    max_mm: float
    pdm_mean_mm: float
    cf: float
    cf_source: str
    model_version: str
    roi: tuple[int, int]


def run_spec(spec: TaskSpec, adapter: ModelAdapter, image: np.ndarray) -> TaskResult:
    """执行一个确定的 TaskSpec：标定 → 分割 → 对称 PDM 测量。"""
    cal = resolve_calibration(cubs_cf=spec.cubs_cf)  # 无标定 → 内核硬拒绝
    roi = ROI(spec.roi[0], spec.roi[1]) if spec.roi is not None else None
    seg = adapter.segment(SegmentationRequest(image=image, roi=roi))
    meas = imt(seg.li, seg.ma, cf=cal.cf)
    return TaskResult(
        task=spec.task.value,
        mean_mm=meas.mean_mm,
        max_mm=meas.max_mm,
        pdm_mean_mm=meas.pdm_mean_mm,
        cf=cal.cf,
        cf_source=cal.source.value,
        model_version=seg.model_version,
        roi=(seg.roi_used.x0, seg.roi_used.x1),
    )


def interpret_and_run(
    nl: str,
    adapter: ModelAdapter,
    image: np.ndarray,
    *,
    image_path: str | None = None,
    cubs_cf: float | None = None,
    roi: tuple[int, int] | None = None,
    backend: IntentBackend | None = None,
) -> TaskResult | IntentResult:
    """NL → 规范 → 执行。非 in-scope 返回 IntentResult（澄清/拒绝），不驱动内核。"""
    backend = backend or RuleBasedBackend()
    intent = backend.interpret(
        nl, image_path=image_path, cubs_cf=cubs_cf, roi=roi, has_image=image is not None
    )
    if intent.scope is not Scope.IN_SCOPE:
        return intent
    return run_spec(intent.spec, adapter, image)
