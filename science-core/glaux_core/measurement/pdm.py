"""IMT 测量（U5）：Polyline Distance Method.

**曲线原生、确定性几何**——不塌缩成区域面积、不经 LLM 估值。

IMT = LI 与 MA 两条边界间的**法向投影距离**（非欧氏逐列纵向差、非 Hausdorff）。
逐列取 LI 点到 MA 折线的最小（垂直）距离得厚度剖面：``mean`` / ``max`` 即
mean/max IMT；乘 CF（mm/pixel）转 mm。另给对称 PDM 均值以对齐 CUBS 口径。

参考：CUBS 技术论文（Meiburger 2022）——"average distance between each point on
one profile and the normal projection to the segment of the other profile"。
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from glaux_core.io.boundaries import Boundary, common_support


@dataclass(frozen=True)
class IMTResult:
    mean_mm: float
    max_mm: float
    per_column_um: np.ndarray  # 逐列厚度（LI→MA 法向），µm
    pdm_mean_mm: float  # 对称 polyline distance 均值（CUBS 口径）
    n_columns: int


def _point_to_polyline(px: float, py: float, poly: np.ndarray) -> float:
    """点 (px,py) 到折线 ``poly``（(N,2)）的最小距离（点-线段法向投影）。"""
    if poly.shape[0] == 1:
        return float(np.hypot(px - poly[0, 0], py - poly[0, 1]))
    a = poly[:-1]
    b = poly[1:]
    ab = b - a
    ap = np.column_stack([px - a[:, 0], py - a[:, 1]])
    denom = (ab**2).sum(axis=1)
    denom = np.where(denom == 0, 1e-12, denom)
    t = np.clip((ap * ab).sum(axis=1) / denom, 0.0, 1.0)
    foot = a + t[:, None] * ab
    d = np.hypot(px - foot[:, 0], py - foot[:, 1])
    return float(d.min())


def polyline_distances(p: np.ndarray, q: np.ndarray) -> np.ndarray:
    """P 上每点到折线 Q 的最小法向距离，返回长度 |P| 的数组。"""
    return np.array([_point_to_polyline(x, y, q) for x, y in p])


def imt(
    li: Boundary, ma: Boundary, cf: float, *, x_window: tuple[float, float] | None = None
) -> IMTResult:
    """在 LI/MA 的公共支撑上计算 mean/max IMT（mm）。

    ``cf`` = mm/pixel。逐列厚度取 LI 点到 MA 折线的法向距离；
    ``pdm_mean_mm`` 为对称 polyline distance（LI↔MA）均值——**跨方法比对的口径**。
    ``x_window`` 给定时把公共支撑再限制到该 x 区间（跨方法共同支撑，见评测层）。
    """
    if not (cf > 0):
        raise ValueError(f"CF 须为正：{cf}")
    cs = common_support(li, ma, x_window=x_window)
    li_pts = np.column_stack([cs.x, cs.li_y])
    ma_pts = np.column_stack([cs.x, cs.ma_y])

    d_li = polyline_distances(li_pts, ma_pts)  # 逐列 LI→MA 法向厚度（像素）
    d_ma = polyline_distances(ma_pts, li_pts)  # 对称方向
    pdm_mean_px = float(np.concatenate([d_li, d_ma]).mean())

    return IMTResult(
        mean_mm=float(d_li.mean()) * cf,
        max_mm=float(d_li.max()) * cf,
        per_column_um=d_li * cf * 1000.0,
        pdm_mean_mm=pdm_mean_px * cf,
        n_columns=len(cs),
    )
