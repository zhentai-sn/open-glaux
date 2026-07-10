"""P6 楔子：Reproducibility Dice —— per-class Sørensen–Dice 系数（纯 numpy）。

与现有 :mod:`glaux_core.verification.*` 体系并行：一致性 / 跨中心 / 不确定度的计算
都在此包；Dice 是 P6 3D 楔子新加的轻量工具。

**语义**：与 ship 的 reference labelmap 对比 per-class Dice。reference 是 TotalSegmentator
公开 demo 的官方预测——衡量「我们的管线能否复现上游 demo」，**非**真 GT 比较。
零空集合（某 class pred 与 ref 都没体素）返回 0.0，不抛。
"""

from __future__ import annotations

import numpy as np


def dice_per_class(
    pred: np.ndarray,
    ref: np.ndarray,
    class_ids: list[int],
) -> dict[int, float]:
    """per-class Sørensen–Dice = 2|p∩g| / (|p| + |g|)。

    - pred / ref 形状必须一致；不一致 ValueError。
    - 零空集合 → 0.0（不抛）。
    - class_id=0（背景）按调用方是否传定；本函数不主动跳过。
    """
    if pred.shape != ref.shape:
        raise ValueError(
            f"pred shape {pred.shape} != ref shape {ref.shape}——硬拒绝，不静默算错 Dice"
        )
    out: dict[int, float] = {}
    for c in class_ids:
        p = pred == c
        g = ref == c
        p_sum = int(p.sum())
        g_sum = int(g.sum())
        if p_sum == 0 and g_sum == 0:
            out[c] = 0.0
            continue
        inter = int(np.logical_and(p, g).sum())
        denom = p_sum + g_sum
        out[c] = (2.0 * inter) / denom if denom > 0 else 0.0
    return out


def mean_dice(per_class: dict[int, float]) -> float:
    """per-class Dice 字典的均值（不计零空类）。"""
    if not per_class:
        return 0.0
    return sum(per_class.values()) / len(per_class)
