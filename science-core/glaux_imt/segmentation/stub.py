"""确定性桩适配器（U4）.

不做真分割——在 ROI 内输出一对给定厚度的水平 LI/MA 边界。用途：
① 契约/端到端接线测试（无需 TF/权重）；② 无模型时的占位演示。
"""

from __future__ import annotations

import numpy as np

from glaux_imt.io.boundaries import Boundary
from glaux_imt.segmentation.base import (
    ModelAdapter,
    SegmentationRequest,
    SegmentationResult,
)
from glaux_imt.segmentation.roi import resolve_roi


class ConstantThicknessAdapter(ModelAdapter):
    """在 ROI 内产出相距 ``thickness_px`` 的一对水平 LI/MA。"""

    name = "stub-constant-thickness"

    def __init__(self, *, li_y: float = 100.0, thickness_px: float = 8.0) -> None:
        self.li_y = float(li_y)
        self.thickness_px = float(thickness_px)

    def segment(self, request: SegmentationRequest) -> SegmentationResult:
        roi = resolve_roi(request.image, request.roi)
        x = np.arange(roi.x0, roi.x1, dtype=float)
        li = Boundary("LI", x, np.full_like(x, self.li_y))
        ma = Boundary("MA", x, np.full_like(x, self.li_y + self.thickness_px))
        return SegmentationResult(
            li=li,
            ma=ma,
            roi_used=roi,
            model_version=f"{self.name}@0",
            meta={"compute": request.compute.value, "stub": True},
        )
