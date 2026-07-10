"""P7 U3 测试：patch 网格切分 + 跨 patch 质心去重（纯函数，P7 头号坑之一）。"""

from __future__ import annotations

import numpy as np
import pytest

from glaux_core.detection.nuclei_post import dedup_centroids, tile_grid


# --- tile_grid ---------------------------------------------------------------


def test_tile_grid_covers_and_clamps():
    boxes = tile_grid(512, 512, patch=256, overlap=32)
    # stride=224 → starts [0, 224, 256(末块贴边)] 去重 → 覆盖 512
    xs = sorted({b[0] for b in boxes})
    assert xs[0] == 0 and xs[-1] == 512 - 256  # 末块贴右边界
    # 所有框不越界
    for x0, y0, x1, y1 in boxes:
        assert 0 <= x0 < x1 <= 512
        assert 0 <= y0 < y1 <= 512


def test_tile_grid_small_roi_single_box():
    boxes = tile_grid(100, 80, patch=256, overlap=32)
    assert boxes == [(0, 0, 100, 80)]


def test_tile_grid_no_gap_at_seam():
    """相邻 patch 必有 overlap（去重前提）——stride < patch。"""
    boxes = tile_grid(1000, 256, patch=256, overlap=32)
    xs = sorted({b[0] for b in boxes})
    for a, b in zip(xs, xs[1:]):
        assert b - a <= 256 - 32 or b == 1000 - 256  # 步长≤stride 或末块贴边


def test_tile_grid_invalid_params():
    with pytest.raises(ValueError):
        tile_grid(0, 100)
    with pytest.raises(ValueError):
        tile_grid(100, 100, patch=256, overlap=256)  # overlap>=patch


# --- dedup_centroids ---------------------------------------------------------


def test_dedup_merges_close_pair():
    """重叠带两质心相距 3px（< 阈值 8）→ 合并为 1。"""
    pts = np.array([[100.0, 100.0], [102.0, 102.0]])  # dist ≈ 2.83
    cids = np.array([1, 1])
    out_pts, out_cids = dedup_centroids(pts, cids, dist_thresh=8.0)
    assert len(out_pts) == 1
    assert tuple(out_pts[0]) == (100.0, 100.0)  # 保留先出现者


def test_dedup_keeps_distant_pair():
    """相距 20px（> 阈值 8）→ 都保留。"""
    pts = np.array([[100.0, 100.0], [120.0, 100.0]])
    cids = np.array([1, 1])
    out_pts, _ = dedup_centroids(pts, cids, dist_thresh=8.0)
    assert len(out_pts) == 2


def test_dedup_cross_cell_boundary():
    """两点跨网格 cell 边界但仍在阈值内 → 3×3 邻域查得到，合并。"""
    # cell=8；点在 (7.9, 50) 与 (8.1, 50)，跨 cell 边界 x=8，距离 0.2 < 8
    pts = np.array([[7.9, 50.0], [8.1, 50.0]])
    cids = np.array([1, 1])
    out_pts, _ = dedup_centroids(pts, cids, dist_thresh=8.0)
    assert len(out_pts) == 1


def test_dedup_empty():
    pts = np.zeros((0, 2))
    cids = np.zeros((0,), dtype=int)
    out_pts, out_cids = dedup_centroids(pts, cids, dist_thresh=8.0)
    assert len(out_pts) == 0 and len(out_cids) == 0


def test_dedup_preserves_class_ids():
    pts = np.array([[10.0, 10.0], [200.0, 200.0], [11.0, 10.0]])  # #0 与 #2 近
    cids = np.array([1, 2, 1])
    out_pts, out_cids = dedup_centroids(pts, cids, dist_thresh=8.0)
    assert len(out_pts) == 2
    assert list(out_cids) == [1, 2]  # 保留 #0(cls1) 与 #1(cls2)，丢 #2


def test_dedup_realistic_overlap_scenario():
    """模拟：ROI 内 100 个真核 + 每个在重叠带被重复检出一次（共 200 点）→ 去重回 ~100。"""
    rng = np.random.RandomState(0)
    true_pts = rng.uniform(0, 1000, size=(100, 2))
    # 每个真核制造一个 1px 抖动的重复
    dup_pts = true_pts + rng.uniform(-1, 1, size=(100, 2))
    all_pts = np.vstack([true_pts, dup_pts])
    all_cids = np.ones(200, dtype=int)
    out_pts, _ = dedup_centroids(all_pts, all_cids, dist_thresh=8.0)
    # 真核间最小间距可能 <8 偶发合并，但应显著少于 200、接近 100
    assert 90 <= len(out_pts) <= 110
