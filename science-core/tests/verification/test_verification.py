"""U6：多方法一致性 / 校准不确定 / 跨中心 LOCO。"""

import numpy as np
import pytest

from glaux_core.verification.consistency import method_agreement
from glaux_core.verification.crosscenter import (
    center_split,
    leave_one_center_out,
    loco_report,
)
from glaux_core.verification.uncertainty import (
    UncertaintyCalibrator,
    absolute_bias_um,
)


# --- consistency ---------------------------------------------------------

def test_method_agreement_flags_outlier_and_hotspot():
    base = np.full(20, 600.0)
    per_method = {
        "A1": base.copy(),
        "CNR_IT": base + 5,
        "TUM_DE": base - 5,
        "bad": base.copy(),
    }
    per_method["bad"][10:] += 300  # 离群方法 + 后半段分歧
    res = method_agreement(per_method, std_threshold=50.0)
    assert "bad" in res.outlier_methods
    assert "A1" not in res.outlier_methods
    assert res.high_variance_columns.min() >= 10  # 热点在后半段


def test_method_agreement_all_concordant_no_outlier():
    per_method = {"A1": np.full(10, 600.0), "A2": np.full(10, 602.0)}
    res = method_agreement(per_method)
    assert res.outlier_methods == []


def test_method_agreement_length_mismatch_raises():
    with pytest.raises(ValueError):
        method_agreement({"a": np.zeros(5), "b": np.zeros(6)})


# --- uncertainty ---------------------------------------------------------

def test_absolute_bias_um_matches_scale():
    a = np.array([0.60, 0.70, 0.80])  # mm
    b = np.array([0.55, 0.72, 0.79])
    r = absolute_bias_um(a, b)
    # |Δ| = [50, 20, 10] µm → mean 26.67
    assert r["abs_bias_mean"] == pytest.approx(26.667, abs=0.01)


def test_uncertainty_calibration_confident_beats_unsure():
    # 信号越大越不确定；误差与信号正相关 → 分流应成立
    rng = np.arange(0, 100, dtype=float)
    signal = rng
    abs_error = rng * 2.0  # 单调
    cal = UncertaintyCalibrator().fit(signal, quantile=0.5)
    rep = cal.calibration_report(signal, abs_error)
    assert rep.separation_ok
    assert rep.confident_mae < rep.unsure_mae


def test_uncertainty_classify_requires_fit():
    with pytest.raises(RuntimeError):
        UncertaintyCalibrator().classify(np.zeros(3))


# --- crosscenter ---------------------------------------------------------

def test_center_split_and_loco_iteration():
    centers = {"clin_1": "Cyprus", "clin_2": "Cyprus", "tech_1": "Pisa"}
    split = center_split(centers)
    assert set(split) == {"Cyprus", "Pisa"}
    folds = list(leave_one_center_out(centers))
    assert len(folds) == 2
    held, test_ids, train_ids = next(f for f in folds if f[0] == "Pisa")
    assert test_ids == ["tech_1"]
    assert set(train_ids) == {"clin_1", "clin_2"}


def test_loco_report_gap():
    centers = {"a": "Cyprus", "b": "Cyprus", "c": "Pisa", "d": "Pisa"}
    abs_error = {"a": 100.0, "b": 120.0, "c": 200.0, "d": 220.0}
    table = loco_report(abs_error, centers)
    assert table["Cyprus"]["mae"] == pytest.approx(110.0)
    assert table["Pisa"]["mae"] == pytest.approx(210.0)
    assert table["Cyprus"]["cross_center_gap"] == pytest.approx(100.0)
