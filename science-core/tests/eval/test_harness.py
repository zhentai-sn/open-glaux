"""U8：评测度量在合成 GT 上自证正确 + 端到端方法评测。"""

import numpy as np
import pytest

from eval.harness import (
    INTRA_OBSERVER_UM,
    agreement,
    bland_altman,
    boundary_dice,
    dice_score,
    evaluate_method,
    hausdorff_distance,
    paired_imt,
)
from glaux_core.io.boundaries import Boundary, BoundaryPair
from glaux_core.measurement.pdm import imt


def _pair(x, li_y, ma_y):
    x = np.asarray(x, float)
    li = np.full_like(x, li_y) if np.isscalar(li_y) else np.asarray(li_y, float)
    ma = np.full_like(x, ma_y) if np.isscalar(ma_y) else np.asarray(ma_y, float)
    return BoundaryPair(li=Boundary("LI", x, li), ma=Boundary("MA", x, ma))


def test_bland_altman_perfect_prediction_zero_bias():
    ref = [0.60, 0.70, 0.80, 0.65]
    ba = bland_altman(ref, ref)
    assert ba.bias_um == pytest.approx(0.0)
    assert ba.abs_bias_mean_um == pytest.approx(0.0)
    assert ba.within_intra_observer()


def test_bland_altman_known_offset_recovers_bias():
    ref = np.array([0.60, 0.70, 0.80])
    pred = ref + 0.05  # +50µm
    ba = bland_altman(pred, ref)
    assert ba.bias_um == pytest.approx(50.0)
    assert ba.abs_bias_mean_um == pytest.approx(50.0)


def test_bland_altman_flags_above_observer_variability():
    ref = np.array([0.60, 0.70, 0.80])
    pred = ref + 0.25  # 250µm，远超观察者内 160
    ba = bland_altman(pred, ref)
    assert ba.abs_bias_mean_um > INTRA_OBSERVER_UM
    assert not ba.within_intra_observer()


def test_dice_identical_and_disjoint():
    a = np.zeros((10, 10), bool)
    a[2:5, 2:5] = True
    assert dice_score(a, a) == pytest.approx(1.0)
    b = np.zeros((10, 10), bool)
    b[7:9, 7:9] = True
    assert dice_score(a, b) == pytest.approx(0.0)


def test_hausdorff_zero_for_identical_and_recovers_shift():
    x = np.arange(0.0, 20.0)
    a = Boundary("LI", x, np.full_like(x, 30.0))
    assert hausdorff_distance(a, a) == pytest.approx(0.0)
    b = Boundary("LI", x, np.full_like(x, 35.0))  # 纵移 5
    assert hausdorff_distance(a, b) == pytest.approx(5.0, abs=1e-6)


def test_boundary_dice_identical_pair():
    x = np.arange(5.0, 25.0)
    pair = BoundaryPair(
        li=Boundary("LI", x, np.full_like(x, 10.0)),
        ma=Boundary("MA", x, np.full_like(x, 16.0)),
    )
    assert boundary_dice(pair, pair, shape=(40, 30)) == pytest.approx(1.0)


def test_paired_imt_restricts_to_cross_method_common_support():
    """支撑失配口径校验：GT 全宽（变厚度）vs 局部方法，只在共同 x 窗量同段壁。"""
    cf = 0.1
    x_ref = np.arange(0.0, 101.0)
    ma_ref = np.where(x_ref < 40, 2.0, 10.0)  # 前段薄 2px、后段厚 10px
    ref = _pair(x_ref, 0.0, ma_ref)
    pred = _pair(np.arange(40.0, 81.0), 0.0, 10.0)  # 只覆盖后段，厚 10px

    imt_pred, imt_ref = paired_imt(pred, ref, cf)
    # 共同窗 [40,80]：两者均 10px → 1.0mm，零偏差
    assert imt_pred == pytest.approx(1.0, abs=1e-6)
    assert imt_ref == pytest.approx(1.0, abs=1e-6)
    # 不截支撑则 GT 全宽均值被薄段拉低 → 与局部不可比（证明对齐口径确有必要）
    full_ref = imt(ref.li, ref.ma, cf).pdm_mean_mm
    assert full_ref < 0.9


def test_agreement_zero_bias_for_identical_method():
    pairs = {"a": _pair(np.arange(0.0, 50.0), 0.0, 6.0),
             "b": _pair(np.arange(10.0, 70.0), 1.0, 8.0)}
    cf = {"a": 0.06, "b": 0.06}
    ba = agreement(pairs, pairs, cf)
    assert ba.bias_um == pytest.approx(0.0, abs=1e-6)
    assert ba.n == 2


def test_agreement_recovers_known_thickness_offset():
    ref = {"a": _pair(np.arange(0.0, 60.0), 0.0, 8.0)}   # 8px
    pred = {"a": _pair(np.arange(0.0, 60.0), 0.0, 10.0)}  # 10px → +2px
    cf = {"a": 0.05}  # +2px × 0.05 = +100µm
    ba = agreement(pred, ref, cf)
    assert ba.bias_um == pytest.approx(100.0, abs=1e-6)


def test_evaluate_method_end_to_end_with_centers():
    ref = {"a": 0.60, "b": 0.70, "c": 0.80, "d": 0.90}
    pred = {"a": 0.61, "b": 0.69, "c": 0.83, "d": 0.86}  # 中心 2 偏差更大
    centers = {"a": "Cyprus", "b": "Cyprus", "c": "Pisa", "d": "Pisa"}
    ev = evaluate_method(pred, ref, centers)
    assert ev.bland_altman.n == 4
    assert ev.cross_center["Cyprus"]["mae"] < ev.cross_center["Pisa"]["mae"]
    assert "cross_center_gap" in ev.cross_center["Cyprus"]
