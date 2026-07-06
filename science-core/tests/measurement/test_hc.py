"""胎儿头围（HC）测量的单元测试。"""

from __future__ import annotations

import math

import numpy as np
import pytest

from glaux_imt.io.contour import Ellipse
from glaux_imt.measurement.hc import hc_from_ellipse, head_circumference


def _sample(cx, cy, a, b, theta, n=120):
    t = np.linspace(0, 2 * math.pi, n, endpoint=False)
    ex, ey = a * np.cos(t), b * np.sin(t)
    ct, st = math.cos(theta), math.sin(theta)
    return np.column_stack([cx + ex * ct - ey * st, cy + ex * st + ey * ct])


def test_hc_of_circle_matches_pi_d():
    # 半径 100 px 的圆，cf=0.1 mm/px → 周长 2π·100·0.1 = 20π mm
    pts = _sample(0, 0, 100, 100, 0.0)
    r = head_circumference(pts, cf=0.1)
    assert r.hc_mm == pytest.approx(20 * math.pi, rel=1e-4)
    assert r.bpd_mm == pytest.approx(20.0, rel=1e-4)
    assert r.ofd_mm == pytest.approx(20.0, rel=1e-4)


def test_hc_scales_linearly_with_cf():
    pts = _sample(50, 40, 80, 55, math.radians(15))
    a = head_circumference(pts, cf=0.2)
    b = head_circumference(pts, cf=0.4)
    assert b.hc_mm == pytest.approx(2 * a.hc_mm, rel=1e-6)


def test_bpd_ofd_from_axes():
    ell = Ellipse(0, 0, a=90, b=60, theta=0.3)
    r = hc_from_ellipse(ell, cf=0.5)
    assert r.ofd_mm == pytest.approx(2 * 90 * 0.5)
    assert r.bpd_mm == pytest.approx(2 * 60 * 0.5)
    assert r.area_mm2 == pytest.approx(math.pi * 90 * 60 * 0.25, rel=1e-9)


def test_hc_rejects_nonpositive_cf():
    pts = _sample(0, 0, 50, 30, 0.0)
    with pytest.raises(ValueError, match="CF 须为正"):
        head_circumference(pts, cf=0.0)


def test_realistic_second_trimester_hc():
    # 生理量级：cf≈0.12mm/px，半轴 ~ 380/300 px → HC ~ 25cm 量级（约 20wk 胎儿）
    pts = _sample(400, 300, 380, 300, math.radians(10))
    r = head_circumference(pts, cf=0.12)
    assert 200 < r.hc_mm < 300  # mm
