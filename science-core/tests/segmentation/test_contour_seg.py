"""闭合轮廓适配器测试：桩 + 真像素亮环椭圆检测。"""

from __future__ import annotations

import math

import numpy as np
import pytest

from glaux_core.io.contour import Ellipse
from glaux_core.segmentation.base import ROI, SegmentationBackendUnavailable
from glaux_core.segmentation.contour import (
    BrightRingEllipseAdapter,
    ContourRequest,
    EllipseContourStub,
)


def _ring_image(h, w, cx, cy, a, b, theta, band=0.11, seed=0):
    """合成一张高回声椭圆颅骨环灰度图（环带亮、内外暗 + 轻散斑）。"""
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    ct, st = math.cos(-theta), math.sin(-theta)
    u = ((xx - cx) * ct - (yy - cy) * st) / a
    v = ((xx - cx) * st + (yy - cy) * ct) / b
    r = np.hypot(u, v)
    img = np.where(np.abs(r - 1.0) < band, 220.0, 20.0)
    rng = np.random.default_rng(seed)
    img = np.clip(img + rng.normal(0, 8, img.shape), 0, 255)
    return img


def test_stub_returns_given_ellipse():
    ell = Ellipse(50, 40, 30, 20, 0.1)
    res = EllipseContourStub(ell, n=120).detect(ContourRequest(image=np.zeros((80, 100))))
    assert res.ellipse is ell
    assert res.points.shape == (120, 2)


def test_bright_ring_recovers_ellipse():
    cx, cy, a, b, th = 160.0, 130.0, 90.0, 65.0, math.radians(18)
    img = _ring_image(260, 320, cx, cy, a, b, th)
    res = BrightRingEllipseAdapter(percentile=90).detect(ContourRequest(image=img))
    e = res.ellipse
    assert e.cx == pytest.approx(cx, abs=2.0)
    assert e.cy == pytest.approx(cy, abs=2.0)
    assert e.a == pytest.approx(a, rel=0.05)
    assert e.b == pytest.approx(b, rel=0.05)
    assert res.meta["n_bright"] > 100


def test_bright_ring_fails_explicitly_when_too_few_bright():
    img = np.full((100, 100), 10.0)  # 近乎均匀 → 只有零星几个亮点，不足以拟合颅骨环
    img[10, 10] = img[20, 20] = img[30, 30] = 255.0
    with pytest.raises(SegmentationBackendUnavailable, match="高回声像素不足"):
        BrightRingEllipseAdapter(percentile=99.99).detect(ContourRequest(image=img))


def test_bright_ring_respects_roi():
    img = _ring_image(260, 320, 160, 130, 90, 65, 0.0)
    roi = ROI(x0=40, x1=300, y0=40, y1=230)
    res = BrightRingEllipseAdapter(percentile=90).detect(ContourRequest(image=img, roi=roi))
    assert res.ellipse.a == pytest.approx(90, rel=0.04)
