"""病理 WSI 核检测测量原语（P7 楔子）——从 PointSet 数质心算计数 + 密度。

- 计数 = ``len(points)``（总数）与 per-class 计数，确定性几何，不经 LLM。
- 密度 = ``count / ROI_area_mm2``（个/mm²），ROI 面积由 ``PointSet.roi`` 框 + MPP 标定换算：
  ``area_mm2 = (w × h) px × mpp_x × mpp_y / 1e6``（mpp 是 µm/px，µm² → mm² 除以 1e6）。
- 标签源是 :class:`~glaux_core.contracts.PointSet.classes`（注册表声明）。

纯 numpy，无外部 IO（点已由 backend 子进程算好、随 PointSet 传入）——与 measure_liver_kidney
不同，此处不读盘。ROI 从 primitive 自带（``PointSet.roi``），不依赖 ``Detection.roi_used``。
"""

from __future__ import annotations

from glaux_core.calibration.calibration import CalibrationResult, CFSource
from glaux_core.contracts import Detection, Measure, Measurement, PointSet


def _mpp_from_cal(cal: CalibrationResult) -> tuple[float, float]:
    """从 MPP 标定取 (mpp_x, mpp_y)（µm/px）。"""
    if cal.source is not CFSource.MPP:
        raise ValueError(f"WSI 核测量需 mpp 标定，得 {cal.source.value}")
    mx, my = cal.value  # type: ignore[misc]
    return float(mx), float(my)


def _roi_area_mm2(roi: tuple[float, float, float, float], mpp: tuple[float, float]) -> float:
    """ROI 框 (x0,y0,x1,y1) level-0 px + MPP → 面积 mm²。"""
    x0, y0, x1, y1 = roi
    w = abs(float(x1) - float(x0))
    h = abs(float(y1) - float(y0))
    mx, my = mpp
    return (w * h) * mx * my / 1e6  # px² × µm²/px² = µm²；/1e6 → mm²


def measure_nuclei(det: Detection, cal: CalibrationResult) -> Measurement:
    """PointSet → 总核数 + per-class 计数 + 核密度（个/mm²）+ ROI 面积（mm²）。

    - 期望 ``det.primitives`` 含 1 枚 :class:`PointSet`。
    - 期望 ``cal.source is CFSource.MPP``。
    - PointSet 必带 ``roi``（框选区域）——否则密度不可算，:class:`ValueError` 硬拒绝。
    """
    ps = next((p for p in det.primitives if isinstance(p, PointSet)), None)
    if ps is None:
        raise ValueError("WSI 核测量需 1 枚 PointSet")
    if ps.roi is None:
        raise ValueError("PointSet 缺 roi——核密度需框选区域算面积，硬拒绝不出无标定假密度")
    mpp = _mpp_from_cal(cal)
    area_mm2 = _roi_area_mm2(ps.roi, mpp)
    if not (area_mm2 > 0):
        raise ValueError(f"ROI 面积非正：{area_mm2}（roi={ps.roi}）——硬拒绝")

    total = len(ps.points)
    metrics: dict[str, Measure] = {
        "nuclei_count": Measure(
            value=float(total), unit="个",
            label_en="Nuclei count", label_zh="核计数",
        ),
        "nuclei_density_mm2": Measure(
            value=float(total) / area_mm2, unit="个/mm²",
            label_en="Nuclei density", label_zh="核密度",
        ),
        "roi_area_mm2": Measure(
            value=area_mm2, unit="mm²",
            label_en="ROI area", label_zh="ROI 面积",
        ),
    }

    # per-class 计数（类别感知模型出多类；类别无关模型全为同一 class，此项与 total 等值）
    counts: dict[int, int] = {}
    for cid in ps.point_class_ids:
        counts[cid] = counts.get(cid, 0) + 1
    for cls in ps.classes:
        if not cls.measurable:
            continue
        metrics[f"{cls.role}_count"] = Measure(
            value=float(counts.get(cls.class_id, 0)), unit="个",
            label_en=f"{cls.label_en} count", label_zh=f"{cls.label_zh}计数",
        )

    return Measurement(metrics=metrics, calibration=cal, overlays=())


def assert_calibration_wsi_or_raise(cal: CalibrationResult) -> None:
    """防御性守卫——非 mpp 标定直接 raise（核密度必走 WSI 标定）。"""
    from glaux_core.errors import HardReject

    if cal.source is not CFSource.MPP:
        raise HardReject(f"WSI 任务需 mpp 标定，得 {cal.source.value}——硬拒绝")
