"""边界叠加渲染（U7）：原图 + LI/MA + ROI，供人工抽检。"""

from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw

from glaux_imt.io.boundaries import Boundary
from glaux_imt.segmentation.base import ROI

_LI_COLOR = (255, 80, 80)  # 红：内界 LI
_MA_COLOR = (80, 160, 255)  # 蓝：外界 MA
_ROI_COLOR = (0, 220, 0)  # 绿：ROI 列带


def _polyline_xy(b: Boundary) -> list[tuple[float, float]]:
    return list(zip(b.x.tolist(), b.y.tolist()))


def render_overlay(
    image: np.ndarray, li: Boundary, ma: Boundary, roi: ROI
) -> Image.Image:
    """把灰度图转 RGB 并画上 LI（红）/ MA（蓝）/ ROI 带（绿边）。"""
    arr = np.asarray(image)
    if arr.ndim == 2:
        base = Image.fromarray(arr.astype(np.uint8), mode="L").convert("RGB")
    else:
        base = Image.fromarray(arr.astype(np.uint8)).convert("RGB")
    draw = ImageDraw.Draw(base)
    h = base.height
    y1 = h - 1 if roi.y1 is None else roi.y1
    y0 = 0 if roi.y0 is None else roi.y0
    draw.rectangle([roi.x0, y0, roi.x1 - 1, y1], outline=_ROI_COLOR, width=1)
    draw.line(_polyline_xy(li), fill=_LI_COLOR, width=1)
    draw.line(_polyline_xy(ma), fill=_MA_COLOR, width=1)
    return base
