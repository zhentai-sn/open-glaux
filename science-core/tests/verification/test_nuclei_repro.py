"""P7 U5 测试：核检测 reproducibility 质心匹配 F1（纯 numpy）。"""

from __future__ import annotations

import numpy as np
import pytest

from glaux_core.verification.nuclei import match_centroids, nuclei_reproducibility


def test_identical_pred_ref_f1_one():
    pts = [[10.0, 10.0], [50.0, 50.0], [100.0, 200.0]]
    r = nuclei_reproducibility(pts, pts, dist_thresh=8.0)
    assert r["f1"] == pytest.approx(1.0)
    assert r["precision"] == pytest.approx(1.0)
    assert r["recall"] == pytest.approx(1.0)
    assert r["tp"] == 3


def test_jittered_within_thresh_still_matches():
    ref = [[10.0, 10.0], [50.0, 50.0]]
    pred = [[12.0, 11.0], [51.0, 49.0]]  # 抖动 < 8px
    r = nuclei_reproducibility(pred, ref, dist_thresh=8.0)
    assert r["f1"] == pytest.approx(1.0)


def test_disjoint_f1_zero():
    ref = [[10.0, 10.0], [20.0, 20.0]]
    pred = [[500.0, 500.0], [600.0, 600.0]]
    r = nuclei_reproducibility(pred, ref, dist_thresh=8.0)
    assert r["f1"] == 0.0
    assert r["tp"] == 0


def test_half_overlap():
    ref = [[10.0, 10.0], [20.0, 20.0], [30.0, 30.0], [40.0, 40.0]]
    pred = [[10.0, 10.0], [20.0, 20.0]]  # 2/4 命中
    r = nuclei_reproducibility(pred, ref, dist_thresh=8.0)
    assert r["tp"] == 2
    assert r["precision"] == pytest.approx(1.0)  # 2/2 pred 都命中
    assert r["recall"] == pytest.approx(0.5)  # 2/4 ref 命中
    assert r["f1"] == pytest.approx(2 / 3)


def test_unique_matching_no_double_count():
    """两个 pred 抢一个 ref（都在阈值内）→ 只算 1 TP（唯一匹配）。"""
    ref = [[10.0, 10.0]]
    pred = [[10.0, 10.0], [11.0, 11.0]]
    r = nuclei_reproducibility(pred, ref, dist_thresh=8.0)
    assert r["tp"] == 1
    assert r["recall"] == pytest.approx(1.0)
    assert r["precision"] == pytest.approx(0.5)


def test_empty_sets():
    assert nuclei_reproducibility([], [], 8.0)["f1"] == 0.0
    r = nuclei_reproducibility([], [[1.0, 1.0]], 8.0)
    assert r["recall"] == 0.0 and r["count_ref"] == 1
    r2 = nuclei_reproducibility([[1.0, 1.0]], [], 8.0)
    assert r2["precision"] == 0.0 and r2["count_pred"] == 1


def test_match_centroids_direct():
    ref = np.array([[0.0, 0.0], [100.0, 0.0]])
    pred = np.array([[1.0, 0.0], [101.0, 0.0], [50.0, 50.0]])
    assert match_centroids(pred, ref, 8.0) == 2
