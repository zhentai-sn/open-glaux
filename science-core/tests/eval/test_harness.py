"""U8：评测度量在合成 GT 上自证正确 + 端到端方法评测。"""

import numpy as np
import pytest

from eval.harness import (
    INTRA_OBSERVER_UM,
    bland_altman,
    boundary_dice,
    dice_score,
    evaluate_method,
    hausdorff_distance,
)
from glaux_imt.io.boundaries import Boundary, BoundaryPair


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


def test_evaluate_method_end_to_end_with_centers():
    ref = {"a": 0.60, "b": 0.70, "c": 0.80, "d": 0.90}
    pred = {"a": 0.61, "b": 0.69, "c": 0.83, "d": 0.86}  # 中心 2 偏差更大
    centers = {"a": "Cyprus", "b": "Cyprus", "c": "Pisa", "d": "Pisa"}
    ev = evaluate_method(pred, ref, centers)
    assert ev.bland_altman.n == 4
    assert ev.cross_center["Cyprus"]["mae"] < ev.cross_center["Pisa"]["mae"]
    assert "cross_center_gap" in ev.cross_center["Cyprus"]
