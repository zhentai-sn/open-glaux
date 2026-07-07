"""椭圆几何 + 直接最小二乘拟合的单元测试。"""

from __future__ import annotations

import math

import numpy as np
import pytest

from glaux_core.io.contour import Ellipse, fit_ellipse


def _sample(cx, cy, a, b, theta, n=60, noise=0.0, seed=0):
    t = np.linspace(0, 2 * math.pi, n, endpoint=False)
    ex, ey = a * np.cos(t), b * np.sin(t)
    ct, st = math.cos(theta), math.sin(theta)
    x = cx + ex * ct - ey * st
    y = cy + ex * st + ey * ct
    if noise:
        rng = np.random.default_rng(seed)
        x = x + rng.normal(0, noise, n)
        y = y + rng.normal(0, noise, n)
    return np.column_stack([x, y])


def test_circle_circumference_is_2pi_r():
    e = Ellipse(cx=0, cy=0, a=10, b=10, theta=0)
    assert e.circumference() == pytest.approx(2 * math.pi * 10, rel=1e-9)
    assert e.area() == pytest.approx(math.pi * 100, rel=1e-9)


def test_ramanujan_accuracy_vs_numeric_integral():
    a, b = 40.0, 25.0
    e = Ellipse(0, 0, a, b, 0.0)
    # 参考周长：极密折线弧长（版本无关，等价于弧长积分）
    poly = e.polygon(n=400000)
    seg = np.diff(np.vstack([poly, poly[:1]]), axis=0)
    ref = float(np.hypot(seg[:, 0], seg[:, 1]).sum())
    assert e.circumference() == pytest.approx(ref, rel=1e-5)


def test_semi_axis_normalization_swaps_when_b_gt_a():
    e = Ellipse(0, 0, a=5, b=9, theta=0.0)  # b>a → 规范化后 a 恒为长轴
    assert e.a == 9 and e.b == 5


def test_fit_recovers_axis_aligned_ellipse():
    pts = _sample(100, 80, 50, 30, 0.0, n=80)
    e = fit_ellipse(pts)
    assert e.cx == pytest.approx(100, abs=1e-6)
    assert e.cy == pytest.approx(80, abs=1e-6)
    assert e.a == pytest.approx(50, abs=1e-6)
    assert e.b == pytest.approx(30, abs=1e-6)


def test_fit_recovers_rotated_ellipse():
    e0 = (120.0, 90.0, 60.0, 35.0, math.radians(35))
    pts = _sample(*e0, n=120)
    e = fit_ellipse(pts)
    assert e.a == pytest.approx(60, abs=1e-4)
    assert e.b == pytest.approx(35, abs=1e-4)
    # 角度取模 π（长轴方向对称）
    dtheta = (e.theta - e0[4]) % math.pi
    assert min(dtheta, math.pi - dtheta) < 1e-3


def test_fit_robust_to_noise():
    pts = _sample(200, 150, 70, 45, math.radians(20), n=200, noise=0.5, seed=3)
    e = fit_ellipse(pts)
    assert e.a == pytest.approx(70, rel=0.05)
    assert e.b == pytest.approx(45, rel=0.05)


def test_fit_rejects_too_few_points():
    with pytest.raises(ValueError, match="至少需 5 点"):
        fit_ellipse(np.array([[0, 0], [1, 1], [2, 0], [1, -1]], dtype=float))


def test_polygon_points_lie_on_ellipse():
    e = Ellipse(10, 20, 30, 15, math.radians(10))
    poly = e.polygon(n=90)
    assert poly.shape == (90, 2)
    re = fit_ellipse(poly)  # 反拟合应还原
    assert re.a == pytest.approx(30, abs=1e-4)
    assert re.b == pytest.approx(15, abs=1e-4)
