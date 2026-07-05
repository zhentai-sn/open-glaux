"""U3：折线表征几何——重采样 / 公共支撑 / 折线↔掩膜。"""

import numpy as np
import pytest

from glaux_imt.io.boundaries import (
    Boundary,
    common_support,
    mask_to_boundaries,
    resample_per_column,
    to_mask,
)


def test_boundary_rejects_mismatched_lengths():
    with pytest.raises(ValueError):
        Boundary("LI", [1, 2, 3], [1, 2])


def test_resample_per_column_integer_grid():
    b = Boundary("LI", [4.0, 8.0], [10.0, 20.0])  # 线性
    r = resample_per_column(b)
    np.testing.assert_array_equal(r.x, np.arange(4, 9))
    np.testing.assert_allclose(r.y, [10, 12.5, 15, 17.5, 20])


def test_common_support_overlap_only():
    li = Boundary("LI", np.arange(0.0, 10.0), np.full(10, 30.0))
    ma = Boundary("MA", np.arange(5.0, 15.0), np.full(10, 36.0))
    cs = common_support(li, ma)
    assert cs.x.min() == 5 and cs.x.max() == 9
    np.testing.assert_allclose(cs.li_y, 30.0)
    np.testing.assert_allclose(cs.ma_y, 36.0)


def test_common_support_disjoint_raises():
    li = Boundary("LI", np.arange(0.0, 3.0), np.zeros(3))
    ma = Boundary("MA", np.arange(10.0, 13.0), np.zeros(3))
    with pytest.raises(ValueError):
        common_support(li, ma)


def test_to_mask_and_back_roundtrip():
    x = np.arange(2.0, 8.0)
    li = Boundary("LI", x, np.full_like(x, 4.0))
    ma = Boundary("MA", x, np.full_like(x, 9.0))
    mask = to_mask(li, ma, shape=(16, 12))
    # 每个覆盖列填充行 4..9 共 6 行
    assert mask[:, 5].sum() == 6
    assert mask[4, 5] and mask[9, 5] and not mask[3, 5]
    back = mask_to_boundaries(mask)
    np.testing.assert_allclose(back.li.y, 4.0)
    np.testing.assert_allclose(back.ma.y, 9.0)


def test_mask_to_boundaries_empty_raises():
    with pytest.raises(ValueError):
        mask_to_boundaries(np.zeros((5, 5), dtype=bool))
