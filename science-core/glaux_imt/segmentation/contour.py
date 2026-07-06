"""闭合轮廓分割接口（多模态）——胎儿头围（HC）等**闭合边界**任务的动作层。

与壁线对分割（:mod:`glaux_imt.segmentation.base` 的 :class:`ModelAdapter` → LI/MA）并列：
这里的适配器给图 + ROI，出**一条闭合轮廓**（离散点）及其拟合椭圆。换/加模型只需新增适配器。

两个 v0.2 适配器：
- :class:`EllipseContourStub`：契约/端到端测试用，返回给定椭圆的多边形（不看像素）。
- :class:`BrightRingEllipseAdapter`：**真处理像素**——阈出高回声颅骨环 → 拟合椭圆 → 内点重拟合。
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

import numpy as np

from glaux_imt.io.contour import Ellipse, fit_ellipse
from glaux_imt.segmentation.base import ROI, SegmentationBackendUnavailable


@dataclass(frozen=True)
class ContourRequest:
    image: np.ndarray  # 灰度 H×W
    roi: ROI | None = None


@dataclass(frozen=True)
class ContourResult:
    points: np.ndarray  # (N,2) 轮廓采样点（拟合输入 / 叠加）
    ellipse: Ellipse  # 拟合椭圆
    model_version: str
    meta: dict = field(default_factory=dict)


class ContourAdapter(ABC):
    """闭合轮廓适配器契约：给图 + ROI，出闭合轮廓点 + 拟合椭圆。"""

    name: str = "abstract-contour"

    @abstractmethod
    def detect(self, request: ContourRequest) -> ContourResult:
        raise NotImplementedError


class EllipseContourStub(ContourAdapter):
    """确定性桩：返回给定椭圆的多边形点（不看像素）——契约 / 无模型演示用。"""

    name = "ellipse-stub"

    def __init__(self, ellipse: Ellipse, n: int = 180) -> None:
        self.ellipse = ellipse
        self.n = int(n)

    def detect(self, request: ContourRequest) -> ContourResult:
        pts = self.ellipse.polygon(self.n)
        return ContourResult(
            points=pts,
            ellipse=self.ellipse,
            model_version=f"{self.name}@0",
            meta={"stub": True},
        )


class BrightRingEllipseAdapter(ContourAdapter):
    """真像素处理：阈出高回声颅骨环像素 → 直接最小二乘椭圆拟合 → 一轮内点重拟合。

    颅骨在超声上是**强回声闭合环**；取高百分位亮度即得环上像素，对其坐标拟合椭圆。
    单轮内点重拟合剔除散斑离群，提升对噪声的鲁棒。缺足够亮像素时**显式失败**（不臆造）。
    """

    name = "bright-ring-ellipse"

    def __init__(self, percentile: float = 90.0, inlier_band: float = 0.28, max_points: int = 4000) -> None:
        self.percentile = float(percentile)
        self.inlier_band = float(inlier_band)
        self.max_points = int(max_points)

    def detect(self, request: ContourRequest) -> ContourResult:
        img = np.asarray(request.image, dtype=float)
        if img.ndim != 2:
            raise SegmentationBackendUnavailable("BrightRingEllipseAdapter 需灰度 H×W")
        if request.roi is not None:
            r = request.roi
            y0 = r.y0 if r.y0 is not None else 0
            y1 = r.y1 if r.y1 is not None else img.shape[0]
            sub = img[y0:y1, r.x0 : r.x1]
            ox, oy = r.x0, y0
        else:
            sub, ox, oy = img, 0, 0

        thr = np.percentile(sub, self.percentile)
        ys, xs = np.where(sub >= thr)
        if xs.size < 5:
            raise SegmentationBackendUnavailable(
                f"高回声像素不足（≥{self.percentile}百分位仅 {xs.size} 点），无法拟合颅骨环"
            )
        pts = np.column_stack([xs + ox, ys + oy]).astype(float)
        if pts.shape[0] > self.max_points:  # 下采样，控拟合规模
            idx = np.linspace(0, pts.shape[0] - 1, self.max_points).astype(int)
            pts = pts[idx]

        ell = fit_ellipse(pts)
        inliers = self._inliers(pts, ell)
        refined = ell
        if inliers.sum() >= 5 and inliers.sum() < pts.shape[0]:
            refined = fit_ellipse(pts[inliers])  # 一轮内点重拟合

        return ContourResult(
            points=pts[self._inliers(pts, refined)],
            ellipse=refined,
            model_version=f"{self.name}@p{self.percentile:g}",
            meta={"n_bright": int(xs.size), "threshold": float(thr)},
        )

    def _inliers(self, pts: np.ndarray, ell: Ellipse) -> np.ndarray:
        """归一化椭圆半径（边界处≈1）落在 [1±band] 的点判为内点。"""
        ct, st = np.cos(-ell.theta), np.sin(-ell.theta)
        dx = pts[:, 0] - ell.cx
        dy = pts[:, 1] - ell.cy
        u = (dx * ct - dy * st) / ell.a  # 旋转回轴对齐并按半轴归一
        v = (dx * st + dy * ct) / ell.b
        r = np.hypot(u, v)
        return np.abs(r - 1.0) <= self.inlier_band
