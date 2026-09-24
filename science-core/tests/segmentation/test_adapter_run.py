"""统一适配器接口测试——`Adapter.run(DetectRequest) -> Detection`（壁线对 / 轮廓）。"""

from __future__ import annotations

import numpy as np

from glaux_core.contracts import Detection, EllipseShape, Polyline
from glaux_core.io.contour import Ellipse
from glaux_core.segmentation.base import ROI, Adapter, DetectRequest, ModelAdapter
from glaux_core.segmentation.contour import ContourAdapter, EllipseContourStub
from glaux_core.segmentation.stub import ConstantThicknessAdapter


def test_adapters_are_unified_adapter_subclasses():
    assert issubclass(ModelAdapter, Adapter)
    assert issubclass(ContourAdapter, Adapter)
    assert ModelAdapter.kind == "wall_pair"
    assert ContourAdapter.kind == "contour"


def test_wall_pair_adapter_run_returns_two_polylines():
    ad = ConstantThicknessAdapter(li_y=100.0, thickness_px=8.0)
    img = np.zeros((200, 120), dtype=float)
    det = ad.run(DetectRequest(image=img, roi=ROI(10, 110)))
    assert isinstance(det, Detection)
    assert [p.role for p in det.primitives] == ["LI", "MA"]
    assert all(isinstance(p, Polyline) for p in det.primitives)
    li, ma = det.primitives
    # MA 恒在 LI 下方 8px（厚度）
    assert ma.points[0][1] - li.points[0][1] == 8.0
    assert det.region == {"kind": "column_window", "x0": 10, "x1": 110}
    assert det.model_version.startswith("stub-constant-thickness")


def test_contour_adapter_run_returns_ellipse_detection():
    e = Ellipse(cx=60.0, cy=50.0, a=40.0, b=30.0, theta=0.0)
    ad = EllipseContourStub(e)
    img = np.zeros((100, 120), dtype=float)
    det = ad.run(DetectRequest(image=img))
    assert isinstance(det, Detection)
    assert len(det.primitives) == 1
    prim = det.primitives[0]
    assert isinstance(prim, EllipseShape)
    assert (prim.cx, prim.cy, prim.a, prim.b) == (60.0, 50.0, 40.0, 30.0)
    assert prim.role == "skull"
    assert det.region is None  # 未给 ROI
