"""远壁 CCA ROI（U4）.

自动检测远壁 + ~1cm 段。真正的远壁定位由 caroSegDeep 的 FW 检测阶段承担
（见 :mod:`glaux_imt.segmentation.carosegdeep`）；此处提供一个**占位启发式**
（居中列带）+ 手动覆盖，保证无模型时管线仍可端到端跑通。可微调（外部传 ROI）。
"""

from __future__ import annotations

import numpy as np

from glaux_imt.segmentation.base import ROI


def auto_far_wall_roi(image: np.ndarray, *, fraction: float = 0.5) -> ROI:
    """占位启发式：取图像中央 ``fraction`` 宽的列带作为 ROI。

    ⚠️ 非真正的远壁检测——真实定位延后给 caroSegDeep FW 阶段。此处只保证
    无模型时也有一个确定性的 ROI 让下游跑通，且可被手动 ROI 覆盖。
    """
    if not (0 < fraction <= 1):
        raise ValueError("fraction 须在 (0,1]")
    h, w = image.shape[:2]
    half = int(w * fraction / 2)
    center = w // 2
    x0 = max(center - half, 0)
    x1 = min(center + half, w)
    if x1 <= x0:
        x0, x1 = 0, w
    return ROI(x0=x0, x1=x1)


def resolve_roi(image: np.ndarray, roi: ROI | None) -> ROI:
    """有手动 ROI 用手动（尊重微调）；否则自动检测。"""
    return roi if roi is not None else auto_far_wall_roi(image)
