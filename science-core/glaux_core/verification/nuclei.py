"""WSI 核检测 reproducibility 验证（P7）——质心匹配 F1。纯 numpy，无 scipy。

**非真 GT 比较**：ship 的 reference 是模型自身在 canonical demo ROI 的检测输出；本指标衡量
「管线能否复现自身的 ROI 检测」（复现好 = F1≈1.0），不是临床正确性。语义诚实标注同 P6 Dice。

匹配：pred 与 ref 质心做**唯一近邻匹配**（一个 ref 只配一个 pred，距离 < 阈值算 TP）——
避免重复计 TP。precision = TP/|pred|，recall = TP/|ref|，F1 = 2PR/(P+R)。
"""

from __future__ import annotations

import numpy as np


def match_centroids(
    pred: np.ndarray, ref: np.ndarray, dist_thresh: float
) -> int:
    """pred 与 ref 质心的唯一近邻匹配 TP 数（贪心：每个 ref 配最近的未用 pred）。"""
    pred = np.asarray(pred, dtype=float).reshape(-1, 2)
    ref = np.asarray(ref, dtype=float).reshape(-1, 2)
    if len(pred) == 0 or len(ref) == 0:
        return 0
    used = np.zeros(len(pred), dtype=bool)
    thresh_sq = float(dist_thresh) * float(dist_thresh)
    tp = 0
    for r in ref:
        d2 = (pred[:, 0] - r[0]) ** 2 + (pred[:, 1] - r[1]) ** 2
        d2[used] = np.inf
        j = int(np.argmin(d2))
        if d2[j] <= thresh_sq:
            used[j] = True
            tp += 1
    return tp


def nuclei_reproducibility(
    pred_points, ref_points, dist_thresh: float = 8.0
) -> dict:
    """pred vs ref 质心 → precision/recall/F1 + 计数。

    - ``pred_points`` / ``ref_points``：``[[x,y], ...]`` level-0 px 坐标。
    - ``dist_thresh``：匹配距离阈值（px）——按核直径量级。
    - 空集合安全：pred 空 → precision=0；ref 空 → recall=0；两空 → 全 0（不抛）。
    """
    pred = np.asarray(pred_points, dtype=float).reshape(-1, 2)
    ref = np.asarray(ref_points, dtype=float).reshape(-1, 2)
    n_pred, n_ref = len(pred), len(ref)
    tp = match_centroids(pred, ref, dist_thresh)
    precision = tp / n_pred if n_pred else 0.0
    recall = tp / n_ref if n_ref else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0
    return {
        "f1": float(f1),
        "precision": float(precision),
        "recall": float(recall),
        "tp": int(tp),
        "count_pred": int(n_pred),
        "count_ref": int(n_ref),
    }
