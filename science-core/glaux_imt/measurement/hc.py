"""胎儿头围（HC）测量——闭合轮廓任务的确定性几何度量。

与 IMT（两条壁线间法向厚度，见 :mod:`glaux_imt.measurement.pdm`）并列的**第二种测量族**：
颅骨轮廓点 → 直接最小二乘椭圆拟合 → Ramanujan 周长 → ×CF 转 mm。

临床 HC 标准即「椭圆拟合周长」（HC18 挑战赛口径）；BPD/OFD 分别对应短/长轴。
所有量都源自同一拟合椭圆，**曲线原生、可复现**，不经区域面积近似或 LLM 估值。
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from glaux_imt.io.contour import Ellipse, fit_ellipse


@dataclass(frozen=True)
class HCResult:
    hc_mm: float  # 头围（椭圆周长），mm
    bpd_mm: float  # 双顶径（短轴 2b），mm
    ofd_mm: float  # 枕额径（长轴 2a），mm
    area_mm2: float  # 椭圆面积，mm²
    ellipse_px: Ellipse  # 拟合椭圆（像素）——供叠加渲染 / 溯源


def head_circumference(points: np.ndarray, cf: float) -> HCResult:
    """由颅骨轮廓点算头围（mm）。``cf`` = mm/pixel；``points`` (N,2) 像素，N ≥ 5。

    先直接最小二乘拟合椭圆，再取 Ramanujan 周长。HC/BPD/OFD/面积同源于该椭圆。
    """
    if not (cf > 0):
        raise ValueError(f"CF 须为正：{cf}")
    ell = fit_ellipse(points)
    return HCResult(
        hc_mm=ell.circumference() * cf,
        bpd_mm=2.0 * ell.b * cf,
        ofd_mm=2.0 * ell.a * cf,
        area_mm2=ell.area() * cf * cf,
        ellipse_px=ell,
    )


def hc_from_ellipse(ell: Ellipse, cf: float) -> HCResult:
    """已有拟合椭圆时直接出测量（跳过拟合）——供适配器已返回椭圆的路径。"""
    if not (cf > 0):
        raise ValueError(f"CF 须为正：{cf}")
    return HCResult(
        hc_mm=ell.circumference() * cf,
        bpd_mm=2.0 * ell.b * cf,
        ofd_mm=2.0 * ell.a * cf,
        area_mm2=ell.area() * cf * cf,
        ellipse_px=ell,
    )
