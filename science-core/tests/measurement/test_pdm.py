"""U5：PDM 测量——合成几何自证正确，含 PDM≠纵向差 的判别测试。"""

import numpy as np
import pytest

from glaux_imt.io.boundaries import Boundary
from glaux_imt.measurement.pdm import imt, polyline_distances


def test_parallel_horizontal_lines_exact():
    # LI y=30, MA y=36, 相距 6px；CF=0.06 → IMT=0.36mm
    x = np.arange(0.0, 50.0)
    li = Boundary("LI", x, np.full_like(x, 30.0))
    ma = Boundary("MA", x, np.full_like(x, 36.0))
    r = imt(li, ma, cf=0.06)
    assert r.mean_mm == pytest.approx(0.36, abs=1e-9)
    assert r.max_mm == pytest.approx(0.36, abs=1e-9)
    assert r.pdm_mean_mm == pytest.approx(0.36, abs=1e-9)
    assert r.per_column_um.mean() == pytest.approx(360.0, abs=1e-6)


def test_pdm_is_perpendicular_not_vertical():
    # 两条平行斜线，斜率 0.5，纵向偏移 6 → 垂直距离 6，但法向距离 = 6/sqrt(1.25) ≈ 5.366
    x_ma = np.arange(0.0, 120.0)  # MA 更宽，保证 LI 各点法向投影落在 MA 内部
    x_li = np.arange(10.0, 90.0)
    li = Boundary("LI", x_li, 0.5 * x_li + 0.0)
    ma = Boundary("MA", x_ma, 0.5 * x_ma + 6.0)
    perp = 6.0 / np.sqrt(1.25)  # ≈ 5.3666
    r = imt(li, ma, cf=1.0)
    # 公共支撑把两端裁到同一列范围，端点法向投影落在段外→回退端点顶点，
    # 使均值从 5.3666 微升至 ~5.377（内部列精确、两端各贡献一点，rel<1%）。
    assert r.mean_mm == pytest.approx(perp, rel=1e-2)
    # 关键判别：落在法向距离带（5.0~5.6）、明显 < 纵向差 6，证明是法向投影
    assert 5.0 < r.mean_mm < 5.6


def test_common_support_restricts_measurement():
    # LI 覆盖 0..9，MA 覆盖 5..14 → 只在公共段 5..9 量
    li = Boundary("LI", np.arange(0.0, 10.0), np.full(10, 20.0))
    ma = Boundary("MA", np.arange(5.0, 15.0), np.full(10, 25.0))
    r = imt(li, ma, cf=0.1)
    assert r.n_columns == 5
    assert r.mean_mm == pytest.approx(0.5)


def test_variable_thickness_max_gt_mean():
    x = np.arange(0.0, 100.0)
    li = Boundary("LI", x, np.full_like(x, 30.0))
    ma = Boundary("MA", x, 36.0 + 4.0 * (x > 50))  # 后半段变厚
    r = imt(li, ma, cf=0.05)
    assert r.max_mm > r.mean_mm
    assert r.max_mm == pytest.approx(10.0 * 0.05, abs=1e-6)  # 厚处 10px


def test_reproduce_imt_from_gold_boundaries():
    # 模拟"金标准边界 + 其 CF 复算 IMT"：厚 8px、CF=0.0833 → ~0.666mm
    x = np.arange(20.0, 180.0)
    li = Boundary("LI", x, np.full_like(x, 100.0))
    ma = Boundary("MA", x, np.full_like(x, 108.0))
    r = imt(li, ma, cf=0.0833)
    assert r.mean_mm == pytest.approx(8 * 0.0833, abs=1e-6)


def test_nonpositive_cf_raises():
    x = np.arange(0.0, 5.0)
    li = Boundary("LI", x, np.zeros(5))
    ma = Boundary("MA", x, np.ones(5))
    with pytest.raises(ValueError):
        imt(li, ma, cf=0.0)


def test_polyline_distances_single_vertex_q():
    p = np.array([[0.0, 0.0], [3.0, 4.0]])
    q = np.array([[0.0, 0.0]])
    d = polyline_distances(p, q)
    np.testing.assert_allclose(d, [0.0, 5.0])
