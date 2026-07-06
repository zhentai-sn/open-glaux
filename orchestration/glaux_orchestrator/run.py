"""规范 → 内核 的驱动（U9，多模态）。

``run_spec`` 把确定的 :class:`TaskSpec` 落成内核调用链，**按任务几何族分派**：
- 壁线对（IMT）：标定 → 分割(LI/MA) → 对称 PDM 厚度。
- 闭合轮廓（HC）：标定 → 轮廓检测(椭圆) → Ramanujan 周长。
``interpret_and_run`` = 意图解析 + 执行；**非 in-scope 直接返回 IntentResult，不碰内核**
（歧义/超范围不静默错跑）。图像以 ndarray 注入，保持编排层与 IO 解耦、可测。
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from glaux_imt.calibration.calibration import resolve_calibration
from glaux_imt.measurement.hc import hc_from_ellipse
from glaux_imt.measurement.pdm import imt
from glaux_imt.segmentation.base import ROI, ModelAdapter, SegmentationRequest
from glaux_imt.segmentation.contour import ContourAdapter, ContourRequest

from glaux_orchestrator.intent import IntentBackend, RuleBasedBackend
from glaux_orchestrator.spec import TASKS, GeometryKind, IntentResult, Scope, TaskSpec


@dataclass(frozen=True)
class TaskResult:
    """壁线对（IMT）执行产物——轻量、可序列化；完整产物/队列 CSV 走内核 artifacts 层。"""

    task: str
    mean_mm: float
    max_mm: float
    pdm_mean_mm: float
    cf: float
    cf_source: str
    model_version: str
    roi: tuple[int, int]


@dataclass(frozen=True)
class HCTaskResult:
    """闭合轮廓（HC）执行产物——头围 + 双顶/枕额径 + 拟合椭圆（供叠加/溯源）。"""

    task: str
    hc_mm: float
    bpd_mm: float
    ofd_mm: float
    area_mm2: float
    cf: float
    cf_source: str
    model_version: str
    ellipse_px: tuple[float, float, float, float, float]  # cx, cy, a, b, theta


def run_spec(
    spec: TaskSpec,
    provider: ModelAdapter | ContourAdapter,
    image: np.ndarray,
) -> TaskResult | HCTaskResult:
    """执行一个确定的 TaskSpec：标定 → 按几何族分派分割/测量。"""
    cal = resolve_calibration(cubs_cf=spec.cubs_cf)  # 无标定 → 内核硬拒绝
    geometry = TASKS[spec.task].geometry

    if geometry is GeometryKind.WALL_PAIR:
        if not isinstance(provider, ModelAdapter):
            raise TypeError(f"{spec.task.value} 需壁线对适配器（ModelAdapter），得 {type(provider).__name__}")
        roi = ROI(spec.roi[0], spec.roi[1]) if spec.roi is not None else None
        seg = provider.segment(SegmentationRequest(image=image, roi=roi))
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

    if geometry is GeometryKind.CLOSED_CONTOUR:
        if not isinstance(provider, ContourAdapter):
            raise TypeError(f"{spec.task.value} 需轮廓适配器（ContourAdapter），得 {type(provider).__name__}")
        roi = ROI(spec.roi[0], spec.roi[1]) if spec.roi is not None else None
        det = provider.detect(ContourRequest(image=image, roi=roi))
        meas = hc_from_ellipse(det.ellipse, cf=cal.cf)
        e = det.ellipse
        return HCTaskResult(
            task=spec.task.value,
            hc_mm=meas.hc_mm,
            bpd_mm=meas.bpd_mm,
            ofd_mm=meas.ofd_mm,
            area_mm2=meas.area_mm2,
            cf=cal.cf,
            cf_source=cal.source.value,
            model_version=det.model_version,
            ellipse_px=(e.cx, e.cy, e.a, e.b, e.theta),
        )

    raise ValueError(f"未支持的几何族：{geometry}")  # pragma: no cover


def interpret_and_run(
    nl: str,
    provider: ModelAdapter | ContourAdapter,
    image: np.ndarray,
    *,
    image_path: str | None = None,
    cubs_cf: float | None = None,
    roi: tuple[int, int] | None = None,
    backend: IntentBackend | None = None,
) -> TaskResult | HCTaskResult | IntentResult:
    """NL → 规范 → 执行。非 in-scope 返回 IntentResult（澄清/拒绝），不驱动内核。"""
    backend = backend or RuleBasedBackend()
    intent = backend.interpret(
        nl, image_path=image_path, cubs_cf=cubs_cf, roi=roi, has_image=image is not None
    )
    if intent.scope is not Scope.IN_SCOPE:
        return intent
    return run_spec(intent.spec, provider, image)
